import { isAppwriteConfigured } from '../lib/appwrite';
import { MotorideRide } from '../types/motoride';

type EventCallback = (payload: any) => void;

class RealtimeSyncManager {
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private sseSource: EventSource | null = null;
  private isConnected: boolean = false;
  private reconnectTimeout: any = null;
  private localChannel: BroadcastChannel | null = null;
  private clientId: string = 'cli_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();

  constructor() {
    this.init();
  }

  private init() {
    // 1. Initialize Local BroadcastChannel for zero-latency multi-tab synchronization
    if (typeof window !== 'undefined' && window.BroadcastChannel) {
      try {
        this.localChannel = new BroadcastChannel('motoride-local-realtime');
        this.localChannel.onmessage = (event) => {
          const { type, payload, senderId } = event.data || {};
          if (type && senderId !== this.clientId) {
            this.emit(type, payload, false); // Don't re-broadcast to local channel
          }
        };
      } catch (err) {
        console.warn('Local BroadcastChannel setup warning:', err);
      }
    }

    // 2. Initialize Shared Backend SSE stream (HTTP-based, no WebSockets required)
    this.connectSSE();

    // 3. Reconnect on tab focus / wake up from background on mobile
    if (typeof window !== 'undefined') {
      const handleWake = () => {
        if (document.visibilityState === 'visible' || navigator.onLine) {
          if (!this.isConnected || !this.sseSource || this.sseSource.readyState === EventSource.CLOSED) {
            this.connectSSE();
          }
          this.requestSync();
        }
      };
      window.addEventListener('visibilitychange', handleWake);
      window.addEventListener('focus', handleWake);
      window.addEventListener('online', handleWake);
    }
  }

  private connectSSE() {
    if (typeof window === 'undefined' || !window.EventSource) return;

    if (this.sseSource) {
      try {
        this.sseSource.close();
      } catch {}
      this.sseSource = null;
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
          if (data && data.event && data.event !== 'PING') {
            this.emit(data.event, data.payload, false);
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

    if (broadcastLocally && typeof window !== 'undefined' && event !== 'CONNECTION_STATUS' && event !== 'PING') {
      try {
        if (this.localChannel) {
          this.localChannel.postMessage({ type: event, payload, senderId: this.clientId });
        } else if (window.BroadcastChannel) {
          const bc = new BroadcastChannel('motoride-local-realtime');
          bc.postMessage({ type: event, payload, senderId: this.clientId });
          bc.close();
        }
      } catch {}
    }
  }

  public broadcast(event: string, data: any) {
    // Emit locally and propagate across all open tabs/windows via BroadcastChannel
    this.emit(event, data, true);
  }

  public requestSync() {
    this.emit('REQUEST_SYNC_RECEIVED', { senderId: this.clientId, timestamp: Date.now() }, true);
  }

  public sendActiveRidesSync(rides: MotorideRide[]) {
    if (Array.isArray(rides) && rides.length > 0) {
      this.emit('ACTIVE_RIDES_SYNC_RECEIVED', rides, true);
    }
  }

  public getStatus() {
    return {
      isConnected: this.isConnected,
      isMqttConnected: false,
      isAppwriteActive: isAppwriteConfigured(),
    };
  }
}

export const realtimeSync = new RealtimeSyncManager();
