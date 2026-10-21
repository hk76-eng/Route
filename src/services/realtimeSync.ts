import { getAppwriteRealtime, isAppwriteConfigured } from '../lib/appwrite';
import { MotorideRide } from '../types/motoride';

type EventCallback = (payload: any) => void;

class RealtimeSyncManager {
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private sseSource: EventSource | null = null;
  private isConnected: boolean = false;
  private reconnectTimeout: any = null;
  private appwriteRealtime: any = null;

  constructor() {
    this.init();
  }

  private init() {
    // 1. Initialize Appwrite Realtime if configured
    if (isAppwriteConfigured()) {
      const rt = getAppwriteRealtime();
      if (rt) {
        try {
          this.appwriteRealtime = rt;
          this.isConnected = true;
          this.emit('CONNECTION_STATUS', { connected: true, type: 'appwrite_realtime' });
        } catch (err) {
          console.warn('Appwrite Realtime setup warning:', err);
        }
      }
    }

    // 2. Initialize Shared Backend SSE stream if available
    this.connectSSE();

    // 3. Initialize Local BroadcastChannel for instant same-browser multi-tab synchronization
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
      this.sseSource.close();
    }

    try {
      this.sseSource = new EventSource('/api/motoride/realtime/stream');

      this.sseSource.onopen = () => {
        this.isConnected = true;
        this.emit('CONNECTION_STATUS', { connected: true, type: 'sse' });
      };

      this.sseSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event && data.event !== 'PING') {
            this.emit(data.event, data.payload);
          }
        } catch {}
      };

      this.sseSource.onerror = () => {
        if (!isAppwriteConfigured()) {
          this.isConnected = false;
          this.emit('CONNECTION_STATUS', { connected: false, type: 'sse' });
        }
        this.sseSource?.close();
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => {
          this.connectSSE();
        }, 8000);
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
    this.emit(event, data);
  }

  public requestSync() {}

  public sendActiveRidesSync(_rides: MotorideRide[]) {}

  public getStatus() {
    return {
      isConnected: this.isConnected,
      isAppwriteActive: isAppwriteConfigured(),
    };
  }
}

export const realtimeSync = new RealtimeSyncManager();
