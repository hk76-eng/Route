import { getAppwriteRealtime, isAppwriteConfigured, appwriteDatabaseId } from '../lib/appwrite';
import { MotorideRide } from '../types/motoride';
import mqtt, { MqttClient } from 'mqtt';

type EventCallback = (payload: any) => void;

const MQTT_TOPIC_EVENTS = 'motoride/v2/events';
const MQTT_TOPIC_LOCATION = 'motoride/v2/location';
const MQTT_TOPIC_SYNC = 'motoride/v2/sync';

class RealtimeSyncManager {
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private sseSource: EventSource | null = null;
  private isConnected: boolean = false;
  private reconnectTimeout: any = null;
  private appwriteRealtime: any = null;
  private appwriteSubscribers: (() => void)[] = [];
  private mqttClient: MqttClient | null = null;
  private clientId: string = 'cli_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();

  constructor() {
    this.init();
  }

  private init() {
    // 1. Initialize Universal Cross-Device MQTT WebSocket Relay
    this.setupMqtt();

    // 2. Initialize Appwrite Realtime if configured
    if (isAppwriteConfigured()) {
      this.setupAppwriteRealtime();
    }

    // 3. Initialize Shared Backend SSE stream if available
    this.connectSSE();

    // 4. Initialize Local BroadcastChannel for instant same-browser multi-tab synchronization
    if (typeof window !== 'undefined' && window.BroadcastChannel) {
      try {
        const localChannel = new BroadcastChannel('motoride-local-realtime');
        localChannel.onmessage = (event) => {
          const { type, payload } = event.data || {};
          if (type && payload) {
            this.emit(type, payload, false); // Don't broadcast it back to local channel
          }
        };
      } catch (err) {
        console.warn('Local BroadcastChannel setup warning:', err);
      }
    }

    // Reconnect on tab focus / wake up from background on mobile
    if (typeof window !== 'undefined') {
      const handleWake = () => {
        if (document.visibilityState === 'visible' || navigator.onLine) {
          if (!this.mqttClient || !this.mqttClient.connected) {
            this.setupMqtt();
          }
          if (!this.isConnected || !this.sseSource || this.sseSource.readyState === EventSource.CLOSED) {
            this.connectSSE();
          }
          this.setupAppwriteRealtime();
          this.requestSync();
        }
      };
      window.addEventListener('visibilitychange', handleWake);
      window.addEventListener('focus', handleWake);
      window.addEventListener('online', handleWake);
    }
  }

  private setupMqtt() {
    if (typeof window === 'undefined') return;

    if (this.mqttClient && this.mqttClient.connected) {
      return;
    }

    try {
      const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
      const client = mqtt.connect(brokerUrl, {
        clientId: this.clientId,
        clean: true,
        connectTimeout: 7000,
        reconnectPeriod: 3000,
        keepalive: 30,
      });

      client.on('connect', () => {
        this.isConnected = true;
        this.emit('CONNECTION_STATUS', { connected: true, type: 'mqtt_relay' }, false);

        // Subscribe to global ride events, location updates, and sync queries
        client.subscribe([MQTT_TOPIC_EVENTS, MQTT_TOPIC_LOCATION, MQTT_TOPIC_SYNC], (err) => {
          if (!err) {
            // Request currently active rides across all devices
            this.requestSync();
          }
        });
      });

      client.on('message', (_topic: string, messageBuffer: any) => {
        try {
          const raw = messageBuffer.toString();
          const parsed = JSON.parse(raw);
          if (!parsed || parsed.senderId === this.clientId) {
            return; // Ignore own published messages
          }

          const { event, payload } = parsed;
          if (event) {
            // Emit directly to internal listeners without re-broadcasting over MQTT
            this.emit(event, payload, false);
          }
        } catch (e) {
          console.warn('MQTT message parse notice:', e);
        }
      });

      client.on('error', (err) => {
        console.warn('MQTT connection notice:', err?.message || err);
      });

      this.mqttClient = client;
    } catch (err) {
      console.warn('MQTT initialization notice:', err);
    }
  }

  private setupAppwriteRealtime() {
    const rt = getAppwriteRealtime();
    if (!rt || !isAppwriteConfigured()) return;

    try {
      this.appwriteSubscribers.forEach((unsub) => {
        try { unsub(); } catch {}
      });
      this.appwriteSubscribers = [];

      this.appwriteRealtime = rt;

      // Subscribe to rides collection documents
      const ridesChannel = `databases.${appwriteDatabaseId}.collections.rides.documents`;
      const unsubRides = rt.subscribe(ridesChannel, (response: any) => {
        const payload = response.payload;
        const events: string[] = response.events || [];
        if (!payload) return;

        const rideId = payload.id || payload.$id;
        if (!rideId) return;

        let parsedOffers = payload.offers;
        if (typeof payload.offers === 'string') {
          try { parsedOffers = JSON.parse(payload.offers); } catch {}
        }

        const rideData: MotorideRide = {
          ...payload,
          id: rideId,
          offers: Array.isArray(parsedOffers) ? parsedOffers : [],
        } as MotorideRide;

        const isCreate = events.some((e: string) => e.includes('.create'));
        const isUpdate = events.some((e: string) => e.includes('.update'));

        if (isCreate || (rideData.status === 'requested' && isUpdate)) {
          this.emit('RIDE_CREATED', rideData, true);
        } else if (rideData.status === 'captain_offered') {
          const offers = rideData.offers || [];
          const lastOffer = offers[offers.length - 1];
          this.emit('RIDE_OFFER_RECEIVED', { ride: rideData, offer: lastOffer }, true);
          this.emit('RIDE_UPDATED', rideData, true);
        } else if (rideData.status === 'captain_accepted') {
          this.emit('RIDE_ACCEPTED', rideData, true);
          this.emit('RIDE_UPDATED', rideData, true);
        } else {
          this.emit('RIDE_UPDATED', rideData, true);
        }
      });

      if (typeof unsubRides === 'function') {
        this.appwriteSubscribers.push(unsubRides);
      }

      // Subscribe to passenger locations collection
      const locChannel = `databases.${appwriteDatabaseId}.collections.passenger_locations.documents`;
      const unsubLoc = rt.subscribe(locChannel, (response: any) => {
        const payload = response.payload;
        if (payload) {
          this.emit('PASSENGER_LOCATION_UPDATED', payload, true);
        }
      });
      if (typeof unsubLoc === 'function') {
        this.appwriteSubscribers.push(unsubLoc);
      }

      this.isConnected = true;
      this.emit('CONNECTION_STATUS', { connected: true, type: 'appwrite_realtime' }, false);
    } catch (err) {
      console.warn('Appwrite Realtime setup warning:', err);
    }
  }

  private connectSSE() {
    if (typeof window === 'undefined' || !window.EventSource) return;

    if (this.sseSource) {
      this.sseSource.close();
    }

    try {
      this.sseSource = new EventSource('/api/motoride/realtime/stream');

      this.sseSource.onopen = () => {
        this.isConnected = true;
        this.emit('CONNECTION_STATUS', { connected: true, type: 'sse' }, false);
      };

      this.sseSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event && data.event !== 'PING') {
            this.emit(data.event, data.payload, false);
          }
        } catch {}
      };

      this.sseSource.onerror = () => {
        this.sseSource?.close();
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => {
          this.connectSSE();
        }, 10000);
      };
    } catch (err) {
      console.warn('SSE connection attempt error:', err);
    }
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

    if (broadcastLocally && typeof window !== 'undefined' && window.BroadcastChannel && event !== 'CONNECTION_STATUS' && event !== 'PING') {
      try {
        const bc = new BroadcastChannel('motoride-local-realtime');
        bc.postMessage({ type: event, payload });
        bc.close();
      } catch {}
    }
  }

  public broadcast(event: string, data: any) {
    // 1. Emit locally to all local subscribers and tabs
    this.emit(event, data, true);

    // 2. Publish globally over MQTT WebSocket for cross-device instant sync
    if (this.mqttClient && this.mqttClient.connected) {
      try {
        let topic = MQTT_TOPIC_EVENTS;
        if (event === 'CAPTAIN_LOCATION_UPDATED' || event === 'PASSENGER_LOCATION_UPDATED') {
          topic = MQTT_TOPIC_LOCATION;
        } else if (event === 'REQUEST_ACTIVE_RIDES' || event === 'ACTIVE_RIDES_SYNC') {
          topic = MQTT_TOPIC_SYNC;
        }

        const msg = JSON.stringify({
          event,
          payload: data,
          senderId: this.clientId,
          timestamp: Date.now(),
        });

        this.mqttClient.publish(topic, msg, { qos: 1 });
      } catch (err) {
        console.warn('MQTT publish error:', err);
      }
    }
  }

  public requestSync() {
    if (this.mqttClient && this.mqttClient.connected) {
      try {
        this.mqttClient.publish(
          MQTT_TOPIC_SYNC,
          JSON.stringify({
            event: 'REQUEST_SYNC_RECEIVED',
            senderId: this.clientId,
            timestamp: Date.now(),
          }),
          { qos: 1 }
        );
      } catch {}
    }
  }

  public sendActiveRidesSync(rides: MotorideRide[]) {
    if (this.mqttClient && this.mqttClient.connected && Array.isArray(rides) && rides.length > 0) {
      try {
        this.mqttClient.publish(
          MQTT_TOPIC_SYNC,
          JSON.stringify({
            event: 'ACTIVE_RIDES_SYNC_RECEIVED',
            payload: rides,
            senderId: this.clientId,
            timestamp: Date.now(),
          }),
          { qos: 1 }
        );
      } catch {}
    }
  }

  public getStatus() {
    return {
      isConnected: this.isConnected,
      isMqttConnected: Boolean(this.mqttClient?.connected),
      isAppwriteActive: isAppwriteConfigured(),
    };
  }
}

export const realtimeSync = new RealtimeSyncManager();
