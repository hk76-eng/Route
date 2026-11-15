import mqtt, { MqttClient } from 'mqtt';
import { appwriteProjectId, isAppwriteConfigured } from '../lib/appwrite';
import {
  isStaticBackendUnavailable,
  markStaticBackendUnavailable,
  resolveMotorideApiBase,
} from '../lib/apiBase';
import { MotorideRide } from '../types/motoride';

type EventCallback = (payload: any) => void;

const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

const CRITICAL_EVENTS = new Set([
  'RIDE_CREATED',
  'RIDE_UPDATED',
  'RIDE_ACCEPTED',
  'RIDE_CANCELLED',
  'RIDE_STATUS_CHANGED',
  'CAPTAIN_ARRIVED',
  'RIDE_OFFER_RECEIVED',
  'ACTIVE_RIDES_SYNC_RECEIVED',
  'REQUEST_SYNC_RECEIVED',
]);

class RealtimeSyncManager {
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private sseSource: EventSource | null = null;
  private mqttClient: MqttClient | null = null;
  private brokerIndex: number = 0;
  private isConnected: boolean = false;
  private isMqttConnected: boolean = false;
  private reconnectTimeout: any = null;
  private mqttReconnectTimer: any = null;
  private sseProbeInFlight: boolean = false;
  private localChannel: BroadcastChannel | null = null;
  private clientId: string = 'cli_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
  private seenMsgIds: Set<string> = new Set();

  constructor() {
    this.init();
  }

  private getMqttTopic(): string {
    const scope = (appwriteProjectId || 'motoride').replace(/[^a-zA-Z0-9_-]/g, '');
    return `route/motoride/${scope}/realtime/v1`;
  }

  private nextMsgId(): string {
    return `${this.clientId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private markSeen(msgId?: string): boolean {
    if (!msgId) return false;
    if (this.seenMsgIds.has(msgId)) return true;
    this.seenMsgIds.add(msgId);
    if (this.seenMsgIds.size > 400) {
      const first = this.seenMsgIds.values().next().value;
      if (first) this.seenMsgIds.delete(first);
    }
    return false;
  }

  private init() {
    if (typeof window === 'undefined') return;

    // 1. Initialize Local BroadcastChannel for zero-latency multi-tab synchronization
    if (window.BroadcastChannel) {
      try {
        this.localChannel = new BroadcastChannel('motoride-local-realtime');
        this.localChannel.onmessage = (event) => {
          const { type, payload, senderId, msgId } = event.data || {};
          if (!type || senderId === this.clientId) return;
          if (this.markSeen(msgId)) return;
          this.dispatchLocal(type, payload);
        };
      } catch (err) {
        console.warn('Local BroadcastChannel setup warning:', err);
      }
    }

    // 2. Initialize Cross-Device MQTT over WSS (works on all static hosts like route.appwrite.network & mobile devices)
    this.connectMQTT();

    // 3. Initialize Backend SSE stream (if Express backend is reachable)
    this.connectSSE();

    // 4. Reconnect on tab focus / wake up from background on mobile
    const handleWake = () => {
      if (document.visibilityState === 'visible' || navigator.onLine) {
        if (!this.isMqttConnected && !this.mqttClient) {
          this.connectMQTT();
        }
        if (!isStaticBackendUnavailable() && (!this.sseSource || this.sseSource.readyState === EventSource.CLOSED)) {
          this.connectSSE();
        }
        this.requestSync();
      }
    };
    window.addEventListener('visibilitychange', handleWake);
    window.addEventListener('focus', handleWake);
    window.addEventListener('online', handleWake);
  }

  private connectMQTT() {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    if (this.mqttClient) {
      try {
        this.mqttClient.end(true);
      } catch {}
      this.mqttClient = null;
    }

    const brokerUrl = MQTT_BROKERS[this.brokerIndex % MQTT_BROKERS.length];
    const topic = this.getMqttTopic();

    try {
      const client = mqtt.connect(brokerUrl, {
        clientId: `rt_${this.clientId.slice(0, 18)}_${Math.random().toString(36).slice(2, 6)}`,
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 5000,
        keepalive: 30,
      });

      this.mqttClient = client;

      client.on('connect', () => {
        this.isMqttConnected = true;
        this.isConnected = true;
        client.subscribe(topic, { qos: 1 }, () => {});
        this.dispatchLocal('CONNECTION_STATUS', { connected: true, type: 'mqtt' });
      });

      client.on('message', (_t, messageBuffer) => {
        try {
          const raw = messageBuffer?.toString?.() || '';
          if (!raw) return;
          const data = JSON.parse(raw);
          const eventName = data?.event || data?.type;
          if (!eventName || eventName === 'PING' || eventName === 'CONNECTION_STATUS') return;
          if (data?.senderId === this.clientId) return;
          if (this.markSeen(data?.msgId)) return;
          this.dispatchLocal(eventName, data.payload);
        } catch {}
      });

      client.on('close', () => {
        this.isMqttConnected = false;
      });

      client.on('offline', () => {
        this.isMqttConnected = false;
      });

      client.on('error', () => {
        this.isMqttConnected = false;
        // Failover silently to secondary broker on connection failure
        if (this.mqttClient === client) {
          this.brokerIndex = (this.brokerIndex + 1) % MQTT_BROKERS.length;
          try {
            client.end(true);
          } catch {}
          this.mqttClient = null;
          clearTimeout(this.mqttReconnectTimer);
          this.mqttReconnectTimer = setTimeout(() => {
            this.connectMQTT();
          }, 3500);
        }
      });
    } catch {
      this.isMqttConnected = false;
    }
  }

  private async connectSSE() {
    if (typeof window === 'undefined' || !window.EventSource) return;
    if (isStaticBackendUnavailable() || this.sseProbeInFlight) return;

    const apiBase = resolveMotorideApiBase();

    // Probe quickly so static SPA hosts (e.g., Appwrite Sites returning index.html) don't loop EventSource errors
    this.sseProbeInFlight = true;
    try {
      const probe = await fetch(`${apiBase}/rides?limit=1`, { method: 'GET' });
      const contentType = probe.headers.get('content-type') || '';
      if (!probe.ok || !contentType.includes('application/json')) {
        markStaticBackendUnavailable();
        this.sseProbeInFlight = false;
        return;
      }
    } catch {
      markStaticBackendUnavailable();
      this.sseProbeInFlight = false;
      return;
    }
    this.sseProbeInFlight = false;

    if (this.sseSource) {
      try {
        this.sseSource.close();
      } catch {}
      this.sseSource = null;
    }

    try {
      this.sseSource = new EventSource(`${apiBase}/realtime/stream`);

      this.sseSource.onopen = () => {
        this.isConnected = true;
        this.dispatchLocal('CONNECTION_STATUS', { connected: true, type: 'sse' });
      };

      this.sseSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.event && data.event !== 'PING' && data.event !== 'CONNECTED') {
            this.dispatchLocal(data.event, data.payload);
          }
        } catch {}
      };

      this.sseSource.onerror = () => {
        try {
          this.sseSource?.close();
        } catch {}
        this.sseSource = null;
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => {
          this.connectSSE();
        }, 12000);
      };
    } catch (err) {
      console.warn('SSE connection attempt error:', err);
    }
  }

  private dispatchLocal(event: string, payload: any) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(payload);
        } catch (err) {
          console.error('Error in realtime event callback:', err);
        }
      });
    }
  }

  private publishRemote(event: string, payload: any, msgId: string) {
    if (typeof window === 'undefined' || event === 'CONNECTION_STATUS' || event === 'PING') return;

    // 1. Same-browser instant BroadcastChannel
    try {
      if (this.localChannel) {
        this.localChannel.postMessage({ type: event, payload, senderId: this.clientId, msgId });
      } else if (window.BroadcastChannel) {
        const bc = new BroadcastChannel('motoride-local-realtime');
        bc.postMessage({ type: event, payload, senderId: this.clientId, msgId });
        bc.close();
      }
    } catch {}

    // 2. Cross-device MQTT over WSS
    try {
      if (this.mqttClient && this.mqttClient.connected) {
        const qos = CRITICAL_EVENTS.has(event) ? 1 : 0;
        this.mqttClient.publish(
          this.getMqttTopic(),
          JSON.stringify({
            event,
            payload,
            senderId: this.clientId,
            msgId,
            ts: Date.now(),
          }),
          { qos }
        );
      }
    } catch {}
  }

  public on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  public emit(event: string, payload: any, broadcastLocally: boolean = true) {
    const msgId = this.nextMsgId();
    this.markSeen(msgId);
    this.dispatchLocal(event, payload);

    if (broadcastLocally) {
      this.publishRemote(event, payload, msgId);
    }
  }

  public broadcast(event: string, data: any) {
    // Emit locally and propagate across BroadcastChannel + MQTT to all open tabs & devices
    this.emit(event, data, true);
  }

  public requestSync() {
    // Ask other connected devices/tabs for currently live ride requests without triggering self-echo locally
    const msgId = this.nextMsgId();
    this.markSeen(msgId);
    this.publishRemote('REQUEST_SYNC_RECEIVED', { senderId: this.clientId, timestamp: Date.now() }, msgId);
  }

  public sendActiveRidesSync(rides: MotorideRide[]) {
    if (Array.isArray(rides) && rides.length > 0) {
      const msgId = this.nextMsgId();
      this.markSeen(msgId);
      this.publishRemote('ACTIVE_RIDES_SYNC_RECEIVED', rides, msgId);
    }
  }

  public getStatus() {
    return {
      isConnected: this.isConnected || this.isMqttConnected,
      isMqttConnected: this.isMqttConnected,
      isAppwriteActive: isAppwriteConfigured(),
    };
  }
}

export const realtimeSync = new RealtimeSyncManager();
