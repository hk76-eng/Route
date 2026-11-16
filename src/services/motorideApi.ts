import {
  MotorideRide,
  Captain,
  Passenger,
  FareSettings,
  DEFAULT_MOTORIDE_FARE_SETTINGS,
  QRCodeSetting,
  WalletTransaction,
  MotorideNotification,
  AdminDashboardStats,
  MotorideRideStatus,
  RideOffer,
  PassengerLiveLocation,
} from '../types/motoride';
import { getAppwriteDatabases, isAppwriteConfigured, appwriteDatabaseId, Permission, Role, Query } from '../lib/appwrite';
import { isStaticBackendUnavailable, markStaticBackendUnavailable, resolveMotorideApiBase } from '../lib/apiBase';
import { safeStorage } from '../lib/safeStorage';
import { appwriteAuth } from '../lib/appwriteAuth';
import { realtimeSync } from './realtimeSync';
import { saveApkBlobToIndexedDb, getApkBlobFromIndexedDb, deleteApkBlobFromIndexedDb } from '../lib/apkStorage';

const STATUS_PROGRESSION: Record<string, number> = {
  requested: 1,
  captain_offered: 2,
  captain_accepted: 3,
  captain_arrived: 4,
  trip_started: 5,
  trip_completed: 6,
  completed: 6,
  cancelled_by_passenger: 7,
  cancelled_by_captain: 7,
};

function mergeRideWithProgression(existing: Partial<MotorideRide> | undefined, incoming: Partial<MotorideRide>): MotorideRide {
  const base = existing || {};
  const existingRank = existing?.status ? (STATUS_PROGRESSION[existing.status] || 0) : 0;
  const incomingRank = incoming?.status ? (STATUS_PROGRESSION[incoming.status] || 0) : 0;
  const effectiveStatus = (existingRank > incomingRank ? existing!.status : incoming.status || existing?.status || 'requested') as MotorideRideStatus;

  return {
    ...base,
    ...incoming,
    status: effectiveStatus,
    offers: incoming.offers && incoming.offers.length > 0 ? incoming.offers : (base.offers || []),
    captain_name: incoming.captain_name || base.captain_name,
    captain_phone: incoming.captain_phone || base.captain_phone,
    vehicle_model: incoming.vehicle_model || base.vehicle_model,
    plate_number: incoming.plate_number || base.plate_number,
    captain_avatar: (incoming as any).captain_avatar || (base as any).captain_avatar,
  } as MotorideRide;
}

const getApiBase = () => resolveMotorideApiBase();

const REALTIME_RIDE_WINDOW_MS = 180 * 1000; // 3 minutes window for real-time incoming requests
const CLOCK_SKEW_TOLERANCE_MS = 10 * 60 * 1000; // Allow up to 10 min clock difference between passenger & captain devices
let appwriteDbMissingUntil = 0;

function isAppwriteDbAvailable(): boolean {
  return Boolean(getAppwriteDatabases() && isAppwriteConfigured() && Date.now() >= appwriteDbMissingUntil);
}

function mapAppwriteDocToRide(doc: any): MotorideRide {
  const rideId = doc.id || doc.$id;
  let parsedOffers = doc.offers;
  if (typeof doc.offers === 'string') {
    try {
      parsedOffers = JSON.parse(doc.offers);
    } catch {}
  }
  const offeredFare = Number(doc.offered_fare ?? doc.fare_amount ?? doc.final_fare ?? 0);
  const finalFare = Number(doc.final_fare ?? doc.fare_amount ?? doc.offered_fare ?? offeredFare);
  return {
    ...doc,
    id: rideId,
    ride_code: doc.ride_code || doc.pin || `RIDE-${String(rideId).slice(-4).toUpperCase()}`,
    dropoff_address: doc.dropoff_address || doc.drop_address || '',
    dropoff_lat: Number(doc.dropoff_lat ?? doc.drop_lat ?? 0),
    dropoff_lng: Number(doc.dropoff_lng ?? doc.drop_lng ?? 0),
    offered_fare: offeredFare,
    final_fare: finalFare,
    estimated_fare: Number(doc.estimated_fare ?? doc.fare_amount ?? offeredFare),
    ride_type: doc.ride_type || doc.type || 'bike',
    payment_method: doc.payment_method || 'cash',
    payment_status: doc.payment_status || 'pending',
    created_at: doc.created_at || doc.$createdAt || new Date().toISOString(),
    updated_at: doc.updated_at || doc.$updatedAt || doc.created_at || doc.$createdAt || new Date().toISOString(),
    offers: Array.isArray(parsedOffers) ? parsedOffers : [],
  } as MotorideRide;
}

function sanitizeForAppwrite(data: Record<string, any>, collectionId?: string): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (key === 'offers' && Array.isArray(value)) {
      result[key] = JSON.stringify(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = JSON.stringify(value);
    } else {
      result[key] = value;
    }
  }
  if (collectionId === 'rides') {
    if (result.dropoff_address !== undefined && result.drop_address === undefined) result.drop_address = result.dropoff_address;
    if (result.dropoff_lat !== undefined && result.drop_lat === undefined) result.drop_lat = result.dropoff_lat;
    if (result.dropoff_lng !== undefined && result.drop_lng === undefined) result.drop_lng = result.dropoff_lng;
    if (result.fare_amount === undefined && (result.offered_fare !== undefined || result.final_fare !== undefined)) {
      result.fare_amount = Number(result.offered_fare ?? result.final_fare ?? 0);
    }
    if (result.type === undefined && result.ride_type !== undefined) result.type = result.ride_type;
    if (result.pin === undefined && result.ride_code !== undefined) result.pin = String(result.ride_code).slice(0, 10);
  }
  return result;
}

async function safeAppwriteCreateDocument(
  collectionId: string,
  documentId: string,
  data: Record<string, any>
): Promise<boolean> {
  const databases = getAppwriteDatabases();
  if (!databases || !isAppwriteDbAvailable()) return false;

  let currentData = sanitizeForAppwrite(data, collectionId);
  const maxRetries = 20;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const permissions = [
        Permission.read(Role.any()),
        Permission.write(Role.any()),
        Permission.update(Role.any()),
        Permission.delete(Role.any()),
      ];
      await databases.createDocument(appwriteDatabaseId, collectionId, documentId, currentData, permissions);
      return true;
    } catch (err: any) {
      const msg = err?.message || err?.toString() || '';
      if (msg.includes('database_not_found') || err?.type === 'database_not_found') {
        appwriteDbMissingUntil = Date.now() + 60 * 1000;
        return false;
      }
      if (err?.code === 404) {
        return false;
      }

      const match = msg.match(/Unknown attribute:\s*"([^"]+)"/) || msg.match(/Unknown attribute:\s*([a-zA-Z0-9_]+)/);
      if (match && match[1] && currentData[match[1]] !== undefined) {
        delete currentData[match[1]];
        continue;
      }

      try {
        await databases.createDocument(appwriteDatabaseId, collectionId, documentId, currentData);
        return true;
      } catch (err2: any) {
        const msg2 = err2?.message || err2?.toString() || '';
        if (msg2.includes('database_not_found') || err2?.type === 'database_not_found') {
          appwriteDbMissingUntil = Date.now() + 60 * 1000;
          return false;
        }
        if (err2?.code === 404) {
          return false;
        }
        const match2 = msg2.match(/Unknown attribute:\s*"([^"]+)"/) || msg2.match(/Unknown attribute:\s*([a-zA-Z0-9_]+)/);
        if (match2 && match2[1] && currentData[match2[1]] !== undefined) {
          delete currentData[match2[1]];
          continue;
        }

        if (attempt === 0 && collectionId === 'rides') {
          const coreKeys = [
            'passenger_id',
            'passenger_name',
            'passenger_phone',
            'pickup_address',
            'pickup_lat',
            'pickup_lng',
            'drop_address',
            'drop_lat',
            'drop_lng',
            'dropoff_address',
            'dropoff_lat',
            'dropoff_lng',
            'distance_km',
            'fare_amount',
            'offered_fare',
            'final_fare',
            'type',
            'ride_type',
            'status',
            'pin',
          ];
          const filtered: Record<string, any> = {};
          for (const k of coreKeys) {
            if (currentData[k] !== undefined) filtered[k] = currentData[k];
          }
          currentData = filtered;
        } else {
          break;
        }
      }
    }
  }
  return false;
}

async function safeAppwriteUpdateDocument(
  collectionId: string,
  documentId: string,
  data: Record<string, any>
): Promise<boolean> {
  const databases = getAppwriteDatabases();
  if (!databases || !isAppwriteDbAvailable()) return false;

  let currentData = sanitizeForAppwrite(data, collectionId);
  const maxRetries = 15;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await databases.updateDocument(appwriteDatabaseId, collectionId, documentId, currentData);
      return true;
    } catch (err: any) {
      const msg = err?.message || err?.toString() || '';
      if (msg.includes('database_not_found') || err?.type === 'database_not_found') {
        appwriteDbMissingUntil = Date.now() + 60 * 1000;
        return false;
      }
      if (err?.code === 404) {
        return false;
      }

      const match = msg.match(/Unknown attribute:\s*"([^"]+)"/) || msg.match(/Unknown attribute:\s*([a-zA-Z0-9_]+)/);
      if (match && match[1] && currentData[match[1]] !== undefined) {
        delete currentData[match[1]];
        continue;
      }
      break;
    }
  }
  return false;
}

// Local and cross-browser memory store for resilient instant sync
const localRidesStore: Map<string, MotorideRide> = new Map();
const localMessagesStore: Map<string, any[]> = new Map();
const liveReceivedAtMap: Map<string, number> = new Map();

export function markRideLiveReceived(rideId: string, timestamp: number = Date.now()): void {
  if (!rideId) return;
  if (!liveReceivedAtMap.has(rideId)) {
    liveReceivedAtMap.set(rideId, timestamp);
  }
}

export function isRideFreshRealtime(r: Partial<MotorideRide> | null | undefined): boolean {
  if (!r || !r.id) return false;
  if (r.status !== 'requested' && r.status !== 'captain_offered') return false;
  const nowMs = Date.now();
  const receivedAt = liveReceivedAtMap.get(r.id);
  if (receivedAt !== undefined && nowMs - receivedAt <= REALTIME_RIDE_WINDOW_MS) {
    return true;
  }
  const rawCreated = r.created_at || (r as any).$createdAt;
  const createdMs = rawCreated ? new Date(rawCreated).getTime() : 0;
  if (!createdMs || isNaN(createdMs)) return false;
  const diff = nowMs - createdMs;
  return diff <= REALTIME_RIDE_WINDOW_MS && diff >= -CLOCK_SKEW_TOLERANCE_MS;
}

// Initialize from safeStorage if available (do not resurrect old/previous pending ride requests)
try {
  const saved = safeStorage.getItem('motoride_active_rides_cache');
  if (saved) {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      const nowMs = Date.now();
      parsed.forEach((r: MotorideRide) => {
        if (r && r.id) {
          const isPending = r.status === 'requested' || r.status === 'captain_offered';
          const ageMs = r.created_at ? nowMs - new Date(r.created_at).getTime() : Infinity;
          if (!isPending || (!isNaN(ageMs) && ageMs <= REALTIME_RIDE_WINDOW_MS)) {
            localRidesStore.set(r.id, r);
          }
        }
      });
    }
  }
} catch {}

const saveLocalRides = () => {
  try {
    const arr = Array.from(localRidesStore.values()).slice(0, 30);
    safeStorage.setItem('motoride_active_rides_cache', JSON.stringify(arr));
  } catch {}
};

realtimeSync.on('RIDE_MESSAGE_RECEIVED', (msg: any) => {
  if (msg && msg.ride_id) {
    const list = localMessagesStore.get(msg.ride_id) || [];
    if (!list.some((m) => m.id === msg.id)) {
      list.push(msg);
      localMessagesStore.set(msg.ride_id, list);
    }
  }
});

realtimeSync.on('RIDE_DELETED', (data: any) => {
  if (data?.id) {
    localRidesStore.delete(data.id);
    liveReceivedAtMap.delete(data.id);
    saveLocalRides();
  }
});

// Listen to incoming real-time broadcast, MQTT, and SSE events to keep local store in sync across all devices
realtimeSync.on('RIDE_CREATED', (ride: MotorideRide) => {
  if (ride && ride.id) {
    markRideLiveReceived(ride.id);
    const existing = localRidesStore.get(ride.id);
    localRidesStore.set(ride.id, existing ? mergeRideWithProgression(existing, ride) : ride);
    saveLocalRides();
  }
});

realtimeSync.on('RIDE_UPDATED', (ride: MotorideRide) => {
  if (ride && ride.id) {
    const existing = localRidesStore.get(ride.id);
    localRidesStore.set(ride.id, mergeRideWithProgression(existing, ride));
    saveLocalRides();
  }
});

realtimeSync.on('RIDE_ACCEPTED', (ride: MotorideRide) => {
  if (ride && ride.id) {
    const existing = localRidesStore.get(ride.id);
    localRidesStore.set(ride.id, mergeRideWithProgression(existing, { ...ride, status: 'captain_accepted' }));
    saveLocalRides();
  }
});

realtimeSync.on('CAPTAIN_ARRIVED', (payload: any) => {
  const ride = payload?.ride;
  const rideId = payload?.ride_id || ride?.id || ride?.$id;
  if (rideId) {
    const existing = localRidesStore.get(rideId);
    localRidesStore.set(
      rideId,
      mergeRideWithProgression(existing, {
        ...(ride || {}),
        id: rideId,
        status: 'captain_arrived',
        captain_current_lat: ride?.pickup_lat || existing?.pickup_lat || ride?.captain_current_lat || existing?.captain_current_lat,
        captain_current_lng: ride?.pickup_lng || existing?.pickup_lng || ride?.captain_current_lng || existing?.captain_current_lng,
      })
    );
    saveLocalRides();
  }
});

realtimeSync.on('RIDE_STATUS_CHANGED', (payload: any) => {
  const ride = payload?.ride;
  const rideId = payload?.ride_id || ride?.id || ride?.$id;
  const status = payload?.status || ride?.status;
  if (rideId && status) {
    const existing = localRidesStore.get(rideId);
    localRidesStore.set(
      rideId,
      mergeRideWithProgression(existing, {
        ...(ride || {}),
        id: rideId,
        status,
      })
    );
    saveLocalRides();
  }
});

realtimeSync.on('RIDE_CANCELLED', (payload: any) => {
  const ride = payload?.ride;
  const rideId = payload?.ride_id || ride?.id || ride?.$id;
  const status = ride?.status || payload?.status || 'cancelled_by_passenger';
  if (rideId) {
    const existing = localRidesStore.get(rideId);
    localRidesStore.set(
      rideId,
      mergeRideWithProgression(existing, {
        ...(ride || {}),
        id: rideId,
        status,
      })
    );
    saveLocalRides();
  }
});

realtimeSync.on('RIDE_OFFER_RECEIVED', (payload: any) => {
  const ride = payload?.ride;
  const offer = payload?.offer;
  if (ride && ride.id) {
    const existing = localRidesStore.get(ride.id);
    const existingOffers = existing?.offers || [];
    const updatedOffers = offer && !existingOffers.some((o: any) => o.id === offer.id)
      ? [...existingOffers, offer]
      : (ride.offers || existingOffers);
    localRidesStore.set(ride.id, mergeRideWithProgression(existing, { ...ride, offers: updatedOffers }));
    saveLocalRides();
  }
});

realtimeSync.on('ACTIVE_RIDES_SYNC_RECEIVED', (rides: MotorideRide[]) => {
  if (Array.isArray(rides)) {
    rides.forEach((r) => {
      if (r && r.id) {
        if (r.status === 'requested' || r.status === 'captain_offered') {
          markRideLiveReceived(r.id);
        }
        const existing = localRidesStore.get(r.id);
        localRidesStore.set(r.id, mergeRideWithProgression(existing, r));
      }
    });
    saveLocalRides();
  }
});

realtimeSync.on('REQUEST_SYNC_RECEIVED', () => {
  const activeRides = Array.from(localRidesStore.values()).filter((r) => isRideFreshRealtime(r));
  if (activeRides.length > 0) {
    realtimeSync.sendActiveRidesSync(activeRides);
  }
});

async function safeFetchJson<T = any>(url: string, options?: RequestInit, fallback: T = {} as T): Promise<T> {
  if (isStaticBackendUnavailable() && url.startsWith('/api/motoride')) {
    return fallback;
  }
  try {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      const text = await res.text();
      if (contentType.includes('text/html') || text.trim().startsWith('<')) {
        if (url.startsWith('/api/motoride')) markStaticBackendUnavailable();
        return fallback;
      }
      if (text && !text.trim().startsWith('The page')) {
        try {
          const errJson = JSON.parse(text);
          if (errJson.error) {
            throw new Error(errJson.error);
          }
        } catch (e: any) {
          if (e.message && e.message !== 'Unexpected token') throw e;
        }
      }
      return fallback;
    }
    const text = await res.text();
    if (!text || text.trim().startsWith('<') || text.trim().startsWith('The page') || contentType.includes('text/html')) {
      if (url.startsWith('/api/motoride')) markStaticBackendUnavailable();
      return fallback;
    }
    return JSON.parse(text) as T;
  } catch (err: any) {
    if (err.message && !err.message.includes('Unexpected token') && !err.message.includes('valid JSON')) {
      console.warn(`API call warning for ${url}:`, err.message);
    }
    return fallback;
  }
}

export function formatRealFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface ApkReleaseInfo {
  version: string;
  fileName: string;
  fileSize: string;
  fileSizeBytes?: number;
  releaseNotes: string;
  uploadedAt: string;
  downloadUrl: string;
  downloadsCount: number;
  isDeleted?: boolean;
  hasBinary?: boolean;
}

export const motorideApi = {
  // 1. Rides
  async getRides(params?: {
    status?: string;
    passenger_id?: string;
    captain_id?: string;
    active_for_captain?: boolean;
  }): Promise<MotorideRide[]> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.set('status', params.status);
    if (params?.passenger_id) queryParams.set('passenger_id', params.passenger_id);
    if (params?.captain_id) queryParams.set('captain_id', params.captain_id);
    if (params?.active_for_captain) queryParams.set('active_for_captain', 'true');

    const map = new Map<string, MotorideRide>();

    // 1. Include local & cross-tab synced in-memory rides
    localRidesStore.forEach((r) => {
      if (r && r.id) map.set(r.id, r);
    });

    // 2. Fetch from backend API if available
    const json = await safeFetchJson<{ rides?: MotorideRide[] }>(
      `${getApiBase()}/rides?${queryParams.toString()}`,
      undefined,
      { rides: [] }
    );
    if (Array.isArray(json?.rides)) {
      json.rides.forEach((r) => {
        if (r && r.id) {
          const existing = localRidesStore.get(r.id) || map.get(r.id);
          const merged = mergeRideWithProgression(existing, r);
          map.set(r.id, merged);
          localRidesStore.set(r.id, merged);
        }
      });
      saveLocalRides();
    }

    // 3. Fetch from Appwrite Cloud Database if configured and accessible
    const databases = getAppwriteDatabases();
    if (databases && isAppwriteDbAvailable()) {
      try {
        let res = await databases
          .listDocuments(appwriteDatabaseId, 'rides', [
            Query.orderDesc('$createdAt'),
            Query.limit(100),
          ])
          .catch((err: any) => {
            if (err?.message?.includes('database_not_found') || err?.type === 'database_not_found') {
              appwriteDbMissingUntil = Date.now() + 60 * 1000;
            }
            return null;
          });
        if (!res && isAppwriteDbAvailable()) {
          res = await databases.listDocuments(appwriteDatabaseId, 'rides').catch((err: any) => {
            if (err?.message?.includes('database_not_found') || err?.type === 'database_not_found') {
              appwriteDbMissingUntil = Date.now() + 60 * 1000;
            }
            return null;
          });
        }
        if (res?.documents && Array.isArray(res.documents)) {
          (res.documents as unknown as any[]).forEach((doc) => {
            if (doc && (doc.id || doc.$id)) {
              const rideFromDoc = mapAppwriteDocToRide(doc);
              const existing = localRidesStore.get(rideFromDoc.id) || map.get(rideFromDoc.id);
              const merged = mergeRideWithProgression(existing, rideFromDoc);
              map.set(rideFromDoc.id, merged);
              localRidesStore.set(rideFromDoc.id, merged);
            }
          });
          saveLocalRides();
        }
      } catch (err) {
        console.warn('Appwrite getRides notice:', err);
      }
    }

    let result = Array.from(map.values());

    // Apply strict filtering to ensure precision (only live real-time requests for captain feed)
    if (params?.active_for_captain) {
      result = result.filter((r) => isRideFreshRealtime(r));
    } else {
      if (params?.status && params.status !== 'all') {
        result = result.filter((r) => r && r.status === params.status);
      }
      if (params?.passenger_id) {
        result = result.filter((r) => r && r.passenger_id === params.passenger_id);
      }
      if (params?.captain_id) {
        result = result.filter((r) => r && r.captain_id === params.captain_id);
      }
    }

    return result.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  },

  markLiveReceived(rideId: string) {
    markRideLiveReceived(rideId);
  },

  isFreshRealtime(ride: Partial<MotorideRide> | null | undefined): boolean {
    return isRideFreshRealtime(ride);
  },

  async getRideById(id: string): Promise<MotorideRide | null> {
    if (localRidesStore.has(id)) {
      return localRidesStore.get(id)!;
    }

    const json = await safeFetchJson<{ ride?: MotorideRide }>(`${getApiBase()}/rides/${id}`, undefined, {});
    if (json?.ride) {
      localRidesStore.set(id, json.ride);
      saveLocalRides();
      return json.ride;
    }

    const databases = getAppwriteDatabases();
    if (databases && isAppwriteDbAvailable()) {
      try {
        const doc = await databases.getDocument(appwriteDatabaseId, 'rides', id).catch(() => null);
        if (doc) {
          const ride = mapAppwriteDocToRide(doc);
          localRidesStore.set(id, ride);
          saveLocalRides();
          return ride;
        }
      } catch (err) {
        console.warn('Appwrite getRideById notice:', err);
      }
    }

    return null;
  },

  async createRide(rideData: Partial<MotorideRide>): Promise<MotorideRide> {
    const rideCode = `RIDE-${Math.floor(1000 + Math.random() * 9000)}`;
    const rideId = `ride_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const payload: MotorideRide = {
      ...rideData,
      id: rideId,
      ride_code: rideCode,
      status: 'requested',
      final_fare: rideData.offered_fare || rideData.estimated_fare || 75,
      payment_status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as MotorideRide;

    // 1. Store locally in memory and persistent storage
    markRideLiveReceived(payload.id);
    localRidesStore.set(payload.id, payload);
    saveLocalRides();

    // 2. Broadcast immediately over Realtime (MQTT / Appwrite / SSE / BroadcastChannel)
    realtimeSync.broadcast('RIDE_CREATED', payload);

    // 3. Post to Appwrite database in background if configured
    safeAppwriteCreateDocument('rides', payload.id, payload).catch(() => {});

    // 4. Also post to backend if running
    safeFetchJson<{ ride?: MotorideRide }>(
      `${getApiBase()}/rides`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      { ride: payload }
    ).catch(() => {});

    return payload;
  },

  cacheRide(ride: MotorideRide): void {
    if (!ride || !ride.id) return;
    const existing = localRidesStore.get(ride.id) || ({} as MotorideRide);
    localRidesStore.set(ride.id, { ...existing, ...ride });
    saveLocalRides();
  },

  async acceptRide(
    rideId: string,
    captainData: {
      captain_id: string;
      captain_name: string;
      captain_avatar?: string;
      captain_phone?: string;
      vehicle_model?: string;
      plate_number?: string;
      accepted_fare?: number;
    },
    existingRideData?: Partial<MotorideRide>
  ): Promise<MotorideRide> {
    const fromStore = localRidesStore.get(rideId);
    const existing: MotorideRide = {
      ...(existingRideData || {}),
      ...(fromStore || {}),
      id: rideId,
    } as MotorideRide;

    const updatedRide: MotorideRide = {
      ...existing,
      id: rideId,
      status: 'captain_accepted',
      captain_id: captainData.captain_id,
      captain_name: captainData.captain_name,
      captain_avatar: (captainData as any).captain_avatar || safeStorage.getItem('motoride_captain_avatar') || undefined,
      captain_phone: captainData.captain_phone,
      vehicle_model: captainData.vehicle_model,
      plate_number: captainData.plate_number,
      final_fare: captainData.accepted_fare || existing.final_fare || 75,
      updated_at: new Date().toISOString(),
    };

    localRidesStore.set(rideId, updatedRide);
    saveLocalRides();

    // Broadcast instantly to all browsers and devices
    realtimeSync.broadcast('RIDE_ACCEPTED', updatedRide);
    realtimeSync.broadcast('RIDE_UPDATED', updatedRide);
    realtimeSync.broadcast('RIDE_STATUS_CHANGED', { ride: updatedRide, status: 'captain_accepted' });

    await safeAppwriteUpdateDocument('rides', rideId, updatedRide);

    safeFetchJson<{ ride: MotorideRide }>(
      `${getApiBase()}/rides/${rideId}/accept`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...captainData, ride: updatedRide }),
      },
      { ride: updatedRide }
    ).catch(() => {});

    return updatedRide;
  },

  async sendCounterOffer(
    rideId: string,
    offerData: {
      captain_id: string;
      captain_name: string;
      captain_avatar?: string;
      avatar_url?: string;
      captain_phone?: string;
      vehicle_model?: string;
      plate_number?: string;
      counter_fare: number;
    }
  ): Promise<{ ride: MotorideRide; offer: RideOffer }> {
    const existing = localRidesStore.get(rideId) || ({ id: rideId } as MotorideRide);
    const updatedRide: MotorideRide = {
      ...existing,
      id: rideId,
      status: 'captain_offered',
      updated_at: new Date().toISOString(),
    };

    const newOffer: RideOffer = {
      id: `off_${Date.now()}`,
      ride_id: rideId,
      ...offerData,
      status: 'pending',
      rating: 4.9,
      created_at: new Date().toISOString(),
    };

    const existingOffers = updatedRide.offers || [];
    updatedRide.offers = [...existingOffers.filter((o) => o.captain_id !== offerData.captain_id), newOffer];

    localRidesStore.set(rideId, updatedRide);
    saveLocalRides();

    await safeAppwriteUpdateDocument('rides', rideId, {
      status: 'captain_offered',
      offers: updatedRide.offers,
      updated_at: updatedRide.updated_at,
    });

    const serverResult = await safeFetchJson<{ ride: MotorideRide; offer: RideOffer }>(
      `${getApiBase()}/rides/${rideId}/offer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(offerData),
      },
      { ride: updatedRide, offer: newOffer }
    );

    const finalRide = serverResult?.ride || updatedRide;
    const finalOffer = serverResult?.offer || newOffer;

    localRidesStore.set(rideId, finalRide);
    saveLocalRides();

    // Broadcast counter offer to passenger immediately across devices
    realtimeSync.broadcast('RIDE_OFFER_RECEIVED', { ride: finalRide, offer: finalOffer });
    realtimeSync.broadcast('RIDE_UPDATED', finalRide);

    return { ride: finalRide, offer: finalOffer };
  },

  async acceptCounterOffer(rideId: string, offerId: string): Promise<MotorideRide> {
    const existing = localRidesStore.get(rideId) || ({ id: rideId } as MotorideRide);
    const acceptedOffer = (existing.offers || []).find((o) => o.id === offerId);
    const updatedRide: MotorideRide = {
      ...existing,
      id: rideId,
      status: 'captain_accepted',
      captain_id: acceptedOffer?.captain_id || existing.captain_id,
      captain_name: acceptedOffer?.captain_name || existing.captain_name,
      captain_avatar: acceptedOffer?.captain_avatar || (acceptedOffer as any)?.avatar_url || (existing as any)?.captain_avatar || (existing as any)?.avatar_url,
      captain_phone: acceptedOffer?.captain_phone || existing.captain_phone,
      vehicle_model: acceptedOffer?.vehicle_model || existing.vehicle_model,
      plate_number: acceptedOffer?.plate_number || existing.plate_number,
      final_fare: acceptedOffer?.counter_fare || existing.final_fare || existing.offered_fare,
      updated_at: new Date().toISOString(),
    };

    localRidesStore.set(rideId, updatedRide);
    saveLocalRides();

    realtimeSync.broadcast('RIDE_ACCEPTED', updatedRide);
    realtimeSync.broadcast('RIDE_UPDATED', updatedRide);

    await safeAppwriteUpdateDocument('rides', rideId, {
      status: 'captain_accepted',
      captain_id: updatedRide.captain_id,
      captain_name: updatedRide.captain_name,
      captain_avatar: (updatedRide as any).captain_avatar,
      captain_phone: updatedRide.captain_phone,
      vehicle_model: updatedRide.vehicle_model,
      plate_number: updatedRide.plate_number,
      final_fare: updatedRide.final_fare,
      updated_at: updatedRide.updated_at,
    });

    const serverRes = await safeFetchJson<{ ride: MotorideRide }>(
      `${getApiBase()}/rides/${rideId}/accept-offer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offer_id: offerId }),
      },
      { ride: updatedRide }
    );

    const finalRide = serverRes?.ride || updatedRide;
    localRidesStore.set(rideId, finalRide);
    saveLocalRides();
    return finalRide;
  },

  async updateRideStatus(
    rideId: string,
    status: MotorideRideStatus,
    extra?: Partial<MotorideRide> & {
      cancellation_reason?: string;
      final_distance_km?: number;
      final_fare?: number;
      [key: string]: any;
    }
  ): Promise<MotorideRide> {
    const existing = localRidesStore.get(rideId) || ({ id: rideId } as MotorideRide);
    const updatedRide: MotorideRide = {
      ...existing,
      id: rideId,
      status,
      ...extra,
      updated_at: new Date().toISOString(),
    };
    if (status === 'trip_started') updatedRide.trip_started_at = new Date().toISOString();
    if (status === 'trip_completed' || status === 'completed') {
      const nowIso = new Date().toISOString();
      updatedRide.trip_completed_at = nowIso;
      (updatedRide as any).completed_at = nowIso;
      updatedRide.payment_status = 'paid';
      if (extra?.final_fare !== undefined) {
        updatedRide.final_fare = extra.final_fare;
        (updatedRide as any).fare_amount = extra.final_fare;
      } else {
        (updatedRide as any).fare_amount = updatedRide.final_fare || updatedRide.offered_fare || 0;
      }
    }

    localRidesStore.set(rideId, updatedRide);
    saveLocalRides();

    realtimeSync.broadcast('RIDE_UPDATED', updatedRide);
    realtimeSync.broadcast('RIDE_STATUS_CHANGED', { ride: updatedRide, status });
    if (status === 'captain_arrived') {
      realtimeSync.broadcast('CAPTAIN_ARRIVED', { ride_id: rideId, ride: updatedRide, status: 'captain_arrived' });
    }
    if (status.includes('cancelled')) {
      realtimeSync.broadcast('RIDE_CANCELLED', { ride_id: rideId, ride: updatedRide });
    }
    if (status === 'trip_completed' || status === 'completed' || status.includes('cancelled')) {
      realtimeSync.broadcast('EARNINGS_UPDATED', { captain_id: updatedRide.captain_id, ride: updatedRide });
    }

    const updatePayload: any = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (extra?.cancellation_reason) updatePayload.cancellation_reason = extra.cancellation_reason;
    if (extra?.final_distance_km) updatePayload.distance_km = extra.final_distance_km;
    if (extra?.final_fare) updatePayload.final_fare = extra.final_fare;
    if (status === 'captain_arrived') {
      const pLat = updatedRide.pickup_lat || extra?.pickup_lat;
      const pLng = updatedRide.pickup_lng || extra?.pickup_lng;
      if (pLat) updatePayload.captain_current_lat = pLat;
      if (pLng) updatePayload.captain_current_lng = pLng;
      if (updatedRide.captain_id) updatePayload.captain_id = updatedRide.captain_id;
      if (updatedRide.captain_name) updatePayload.captain_name = updatedRide.captain_name;
      if (updatedRide.captain_phone) updatePayload.captain_phone = updatedRide.captain_phone;
      if (updatedRide.vehicle_model) updatePayload.vehicle_model = updatedRide.vehicle_model;
      if (updatedRide.plate_number) updatePayload.plate_number = updatedRide.plate_number;
    }
    if (status === 'trip_started') updatePayload.trip_started_at = new Date().toISOString();
    if (status === 'trip_completed' || status === 'completed') {
      const nowIso = new Date().toISOString();
      updatePayload.trip_completed_at = nowIso;
      updatePayload.completed_at = nowIso;
      updatePayload.payment_status = 'paid';
      if (extra?.final_fare !== undefined) {
        updatePayload.final_fare = extra.final_fare;
        updatePayload.fare_amount = extra.final_fare;
      }
    }
    await Promise.allSettled([
      safeAppwriteUpdateDocument('rides', rideId, updatePayload),
      safeFetchJson<{ ride: MotorideRide }>(
        `${getApiBase()}/rides/${rideId}/status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, ...extra }),
        },
        { ride: updatedRide }
      ),
    ]);

    // Redundant broadcast to guarantee instant UI update
    if (status === 'captain_arrived') {
      realtimeSync.broadcast('CAPTAIN_ARRIVED', { ride_id: rideId, ride: updatedRide, status: 'captain_arrived' });
    }
    if (status.includes('cancelled')) {
      realtimeSync.broadcast('RIDE_CANCELLED', { ride_id: rideId, ride: updatedRide });
    }
    realtimeSync.broadcast('RIDE_STATUS_CHANGED', { ride: updatedRide, status });
    realtimeSync.broadcast('RIDE_UPDATED', updatedRide);

    return updatedRide;
  },

  async submitRideRating(payload: {
    ride_id: string;
    rater_role: 'captain' | 'passenger';
    captain_id: string;
    passenger_id: string;
    score: number;
    review?: string;
    tags?: string[];
  }): Promise<boolean> {
    const databases = getAppwriteDatabases();
    if (databases && isAppwriteConfigured()) {
      try {
        await databases.createDocument(appwriteDatabaseId, 'ratings', `rat_${Date.now()}`, {
          ride_id: payload.ride_id,
          passenger_id: payload.passenger_id,
          captain_id: payload.captain_id,
          score: payload.score,
          review: payload.review || (payload.tags && payload.tags.length > 0 ? payload.tags.join(', ') : ''),
          created_at: new Date().toISOString(),
        }).catch(() => {});
      } catch (err) {
        console.warn('Appwrite rating save notice:', err);
      }
    }
    return true;
  },

  async updateCaptainLocation(rideId: string, lat: number, lng: number): Promise<void> {
    realtimeSync.broadcast('CAPTAIN_LOCATION_UPDATED', { ride_id: rideId, lat, lng });
    fetch(`${getApiBase()}/rides/${rideId}/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng }),
    }).catch(() => {});
  },

  // Real-Time Captain Live Location (Continuous GPS tracking)
  async updateCaptainLiveLocation(data: {
    captain_id: string;
    ride_id?: string | null;
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  }): Promise<void> {
    // Broadcast live location to passenger's screen
    realtimeSync.broadcast('CAPTAIN_LOCATION_UPDATED', {
      captain_id: data.captain_id,
      ride_id: data.ride_id,
      lat: data.latitude,
      lng: data.longitude,
      heading: data.heading,
      speed: data.speed,
    });

    const databases = getAppwriteDatabases();
    if (databases && isAppwriteConfigured()) {
      try {
        await databases.updateDocument(appwriteDatabaseId, 'captains', data.captain_id, {
          current_lat: data.latitude,
          current_lng: data.longitude,
          current_heading: data.heading ?? 0,
          updated_at: new Date().toISOString(),
        }).catch(() => {});

        if (data.ride_id) {
          await databases.updateDocument(appwriteDatabaseId, 'rides', data.ride_id, {
            captain_current_lat: data.latitude,
            captain_current_lng: data.longitude,
            updated_at: new Date().toISOString(),
          }).catch(() => {});
        }
      } catch (err) {
        console.warn('Appwrite captain location update notice:', err);
      }
    }

    if (data.ride_id) {
      fetch(`${getApiBase()}/rides/${data.ride_id}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: data.latitude, lng: data.longitude }),
      }).catch(() => {});
    }

    fetch(`${getApiBase()}/captain-location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => {});
  },

  // Real-Time Passenger Live Location
  async updatePassengerLiveLocation(data: {
    passenger_id: string;
    ride_id?: string | null;
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  }): Promise<void> {
    // Broadcast live passenger location to captain's screen
    realtimeSync.broadcast('PASSENGER_LOCATION_UPDATED', {
      passenger_id: data.passenger_id,
      ride_id: data.ride_id,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy,
      heading: data.heading,
      speed: data.speed,
    });

    const databases = getAppwriteDatabases();
    if (databases && isAppwriteConfigured()) {
      try {
        await databases.createDocument(appwriteDatabaseId, 'passenger_locations', `ploc_${Date.now()}`, {
          passenger_id: data.passenger_id,
          ride_id: data.ride_id || null,
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: data.accuracy ?? null,
          heading: data.heading ?? null,
          speed: data.speed ?? null,
          updated_at: new Date().toISOString(),
        }).catch(() => {});
      } catch (err) {
        console.warn('Appwrite passenger location notice:', err);
      }
    }

    fetch(`${getApiBase()}/passenger-location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => {});
  },

  async getPassengerLiveLocation(
    rideId?: string,
    _passengerId?: string
  ): Promise<PassengerLiveLocation | null> {
    if (rideId) {
      try {
        const res = await fetch(`${getApiBase()}/rides/${rideId}/passenger-location`);
        if (res.ok) {
          const json = await res.json();
          return json.location || null;
        }
      } catch {}
    }

    return null;
  },

  // 2. Captains
  async getAvailableCaptains(
    userLat?: number,
    userLng?: number
  ): Promise<{ captains: (Captain & { distance_km?: number; eta_minutes?: number; is_nearest?: boolean })[]; nearestCaptain: (Captain & { distance_km?: number; eta_minutes?: number; is_nearest?: boolean }) | null }> {
    try {
      const queryParams = new URLSearchParams();
      if (typeof userLat === 'number') queryParams.set('lat', userLat.toString());
      if (typeof userLng === 'number') queryParams.set('lng', userLng.toString());

      const res = await fetch(`${getApiBase()}/captains/available?${queryParams.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.captains)) {
          return {
            captains: json.captains,
            nearestCaptain: json.nearest_captain || json.captains[0] || null,
          };
        }
      }
    } catch (err) {
      console.warn('getAvailableCaptains API fallback:', err);
    }

    const fallbackCaptains = await this.getCaptains();
    const online = Array.isArray(fallbackCaptains)
      ? fallbackCaptains.filter((c) => c && c.is_online !== false && c.is_approved !== false && c.is_active !== false)
      : [];
    return {
      captains: online,
      nearestCaptain: online[0] || null,
    };
  },

  async getCaptains(): Promise<Captain[]> {
    const json = await safeFetchJson<{ captains?: Captain[] }>(`${getApiBase()}/captains`, undefined, { captains: [] });
    return Array.isArray(json?.captains) ? json.captains : [];
  },

  async getCaptainById(id: string): Promise<Captain | null> {
    const json = await safeFetchJson<{ captain?: Captain }>(`${getApiBase()}/captains/${id}`, undefined, {});
    return json?.captain || null;
  },

  // Today's Income Calculation Engine
  // Calculates SUM(fare_amount) for rides where captain_id = :captainId AND status = 'completed' (or 'trip_completed')
  async getCaptainTodayIncome(
    captainId: string,
    timezone: string = 'Asia/Kolkata'
  ): Promise<{ today_income: number; completed_rides_today: number; today_date: string }> {
    const now = new Date();
    let todayDateStr: string;
    try {
      todayDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
    } catch {
      todayDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
    }

    let todayIncome = 0;
    let completedCount = 0;

    // 1. Query Server API endpoint /api/captains/:id/today-income
    try {
      const json = await safeFetchJson<{
        success: boolean;
        today_income: number;
        completed_rides_today: number;
        today_date: string;
      }>(`${getApiBase()}/captains/${captainId}/today-income?tz=${encodeURIComponent(timezone)}`);

      if (json && typeof json.today_income === 'number') {
        todayIncome = json.today_income;
        completedCount = json.completed_rides_today;
      }
    } catch {
      // Fallback
    }

    // 2. Check memory/local storage fallback store
    let localSum = 0;
    let localCount = 0;
    for (const r of localRidesStore.values()) {
      const isCompleted = r.status === 'completed' || r.status === 'trip_completed';
      if (r.captain_id === captainId && isCompleted) {
        const ts = (r as any).completed_at || r.trip_completed_at;
        if (ts) {
          const rideDate = new Date(ts);
          if (!isNaN(rideDate.getTime())) {
            const rDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(rideDate);
            if (rDateStr === todayDateStr) {
              const fare = Number((r as any).fare_amount ?? r.final_fare ?? r.offered_fare ?? 0);
              localSum += fare;
              localCount++;
            }
          }
        }
      }
    }

    if (localSum > todayIncome || (completedCount === 0 && localCount > 0)) {
      todayIncome = localSum;
      completedCount = localCount;
    }

    return {
      today_income: Number(todayIncome.toFixed(2)),
      completed_rides_today: completedCount,
      today_date: todayDateStr,
    };
  },

  async toggleCaptainOnline(id: string, is_online?: boolean): Promise<Captain> {
    const json = await safeFetchJson<{ captain?: Captain }>(`${getApiBase()}/captains/${id}/toggle-online`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_online }),
    });
    return json?.captain || ({ id, is_online: Boolean(is_online) } as any);
  },

  async updateCaptainProfile(
    id: string,
    profileData: { full_name?: string; phone?: string; avatar_url?: string }
  ): Promise<Captain> {
    const json = await safeFetchJson<{ captain: Captain }>(`${getApiBase()}/captains/${id}/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileData),
    });
    return json.captain;
  },

  async updateCaptainVehicle(
    id: string,
    vehicleData: { model: string; plate_number: string; vehicle_type?: string; color?: string }
  ): Promise<Captain> {
    const json = await safeFetchJson<{ captain: Captain }>(`${getApiBase()}/captains/${id}/vehicle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vehicleData),
    });
    return json.captain;
  },

  async updateCaptainApproval(id: string, is_approved: boolean, is_active?: boolean): Promise<Captain> {
    const json = await safeFetchJson<{ captain: Captain }>(`${getApiBase()}/captains/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_approved, is_active }),
    });
    return json.captain;
  },

  // 3. Passengers
  async getAccounts(): Promise<any[]> {
    const json = await safeFetchJson<{ accounts?: any[] }>(`${getApiBase()}/auth/accounts`, undefined, { accounts: [] });
    return json.accounts || [];
  },

  async getPassengers(): Promise<Passenger[]> {
    const json = await safeFetchJson<{ passengers?: Passenger[] }>(`${getApiBase()}/passengers`, undefined, { passengers: [] });
    return json.passengers || [];
  },

  async updatePassengerProfile(
    id: string,
    profileData: { full_name?: string; name?: string; phone?: string; email?: string; emergency_contact?: string }
  ): Promise<Passenger> {
    const json = await safeFetchJson<{ passenger: Passenger }>(`${getApiBase()}/passengers/${id}/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileData),
    });
    return json?.passenger || ({} as Passenger);
  },

  // 4. Fare Settings
  async getFareSettings(): Promise<FareSettings> {
    try {
      const local = safeStorage.getItem('motoride_admin_fare_settings');
      if (local) {
        const parsed = JSON.parse(local);
        return {
          ...DEFAULT_MOTORIDE_FARE_SETTINGS,
          ...parsed,
          ride_charges: {
            ...DEFAULT_MOTORIDE_FARE_SETTINGS.ride_charges,
            ...(parsed.ride_charges || {}),
          },
          courier_charges: {
            ...DEFAULT_MOTORIDE_FARE_SETTINGS.courier_charges,
            ...(parsed.courier_charges || {}),
          },
        };
      }
    } catch {}

    const json = await safeFetchJson<{ settings: FareSettings }>(`${getApiBase()}/fare-settings`, undefined, {
      settings: DEFAULT_MOTORIDE_FARE_SETTINGS,
    });
    const returned = json.settings || DEFAULT_MOTORIDE_FARE_SETTINGS;
    return {
      ...DEFAULT_MOTORIDE_FARE_SETTINGS,
      ...returned,
      ride_charges: {
        ...DEFAULT_MOTORIDE_FARE_SETTINGS.ride_charges,
        ...(returned.ride_charges || {}),
      },
      courier_charges: {
        ...DEFAULT_MOTORIDE_FARE_SETTINGS.courier_charges,
        ...(returned.courier_charges || {}),
      },
    };
  },

  async updateFareSettings(settings: Partial<FareSettings>): Promise<FareSettings> {
    try {
      const existing = safeStorage.getItem('motoride_admin_fare_settings');
      const parsed = existing ? JSON.parse(existing) : {};
      const merged = { ...parsed, ...settings };
      safeStorage.setItem('motoride_admin_fare_settings', JSON.stringify(merged));
    } catch {}

    const json = await safeFetchJson<{ settings: FareSettings }>(`${getApiBase()}/fare-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    return json.settings || (settings as FareSettings);
  },

  async updateRideCharges(charges: Partial<import('../types/motoride').RideChargeSettings>): Promise<FareSettings> {
    return this.updateFareSettings({ ride_charges: charges as any });
  },

  async updateCourierCharges(charges: Partial<import('../types/motoride').CourierChargeSettings>): Promise<FareSettings> {
    return this.updateFareSettings({ courier_charges: charges as any });
  },

  // 5. QR Code Settings
  async getQRSettings(): Promise<QRCodeSetting> {
    const json = await safeFetchJson<{ qr: QRCodeSetting }>(`${getApiBase()}/qr-settings`, undefined, {
      qr: {
        id: 'default',
        upi_id: 'route.pay@upi',
        merchant_name: 'Route Payments',
        note: 'Route Ride Fare',
        is_active: true,
        qr_image_url: 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=upi://pay?pa=route.pay@upi',
        updated_at: new Date().toISOString(),
      },
    });
    return json.qr;
  },

  async updateQRSettings(qr: Partial<QRCodeSetting>): Promise<QRCodeSetting> {
    const json = await safeFetchJson<{ qr: QRCodeSetting }>(`${getApiBase()}/qr-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(qr),
    });
    return json.qr;
  },

  // 6. Wallet
  async getWallet(userId: string): Promise<{ wallet: { balance: number; currency: string }; transactions: WalletTransaction[] }> {
    const json = await safeFetchJson<{ wallet?: { balance: number; currency: string }; transactions?: WalletTransaction[] }>(
      `${getApiBase()}/wallet/${userId}`,
      undefined,
      { wallet: { balance: 0, currency: '₹' }, transactions: [] }
    );
    return {
      wallet: json.wallet || { balance: 0, currency: '₹' },
      transactions: json.transactions || [],
    };
  },

  async topupWallet(userId: string, amount: number): Promise<{ balance: number }> {
    const json = await safeFetchJson<{ wallet: { balance: number } }>(`${getApiBase()}/wallet/${userId}/topup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    }, { wallet: { balance: amount } });
    return json.wallet;
  },

  // 7. Admin Stats & Notifications
  async getAdminStats(): Promise<AdminDashboardStats> {
    const json = await safeFetchJson<{ stats: AdminDashboardStats }>(`${getApiBase()}/stats`, undefined, {
      stats: {
        totalPassengers: 0,
        totalCaptains: 0,
        onlineCaptains: 0,
        activeRides: 0,
        completedRides: 0,
        cancelledRides: 0,
        todayRides: 0,
        todayPlatformRevenue: 0,
        totalVolume: 0,
      },
    });
    return json.stats;
  },

  async getNotifications(): Promise<MotorideNotification[]> {
    const json = await safeFetchJson<{ notifications?: MotorideNotification[] }>(`${getApiBase()}/notifications`, undefined, {
      notifications: [],
    });
    return json.notifications || [];
  },

  // 8. Ride Chat Messages
  async getRideMessages(rideId: string): Promise<any[]> {
    const map = new Map<string, any>();

    // 1. Local memory store
    const local = localMessagesStore.get(rideId) || [];
    local.forEach((m) => { if (m && m.id) map.set(m.id, m); });

    // 2. Fetch from Backend API
    const json = await safeFetchJson<{ messages?: any[] }>(`${getApiBase()}/rides/${rideId}/messages`, undefined, { messages: [] });
    if (json?.messages && Array.isArray(json.messages)) {
      json.messages.forEach((m: any) => {
        if (m && m.id) map.set(m.id, m);
      });
    }

    const result = Array.from(map.values()).sort(
      (a, b) => new Date(a.created_at || a.timestamp || 0).getTime() - new Date(b.created_at || b.timestamp || 0).getTime()
    );
    localMessagesStore.set(rideId, result);
    return result;
  },

  async sendRideMessage(rideId: string, data: { sender_id: string; sender_role: 'passenger' | 'captain'; sender_name: string; message: string }): Promise<any> {
    const newMsg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      ride_id: rideId,
      ...data,
      created_at: new Date().toISOString(),
    };

    // 1. Store locally
    const list = localMessagesStore.get(rideId) || [];
    if (!list.some((m) => m.id === newMsg.id)) {
      list.push(newMsg);
      localMessagesStore.set(rideId, list);
    }

    // 2. Broadcast instantly via Realtime
    realtimeSync.broadcast('RIDE_MESSAGE_RECEIVED', newMsg);

    // 3. Post to Backend API
    safeFetchJson<{ message?: any }>(
      `${getApiBase()}/rides/${rideId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          id: newMsg.id,
          created_at: newMsg.created_at,
        }),
      },
      { message: newMsg }
    ).catch(() => {});

    return newMsg;
  },

  // 9. Admin Purge and Individual Item Delete Operations
  async deleteCaptain(id: string): Promise<boolean> {
    const json = await safeFetchJson<{ success: boolean; deleted: boolean }>(`${getApiBase()}/captains/${id}`, {
      method: 'DELETE',
    });
    return Boolean(json?.success);
  },

  async deletePassenger(id: string): Promise<boolean> {
    const json = await safeFetchJson<{ success: boolean; deleted: boolean }>(`${getApiBase()}/passengers/${id}`, {
      method: 'DELETE',
    });
    return Boolean(json?.success);
  },

  async deleteRide(id: string): Promise<boolean> {
    localRidesStore.delete(id);
    saveLocalRides();
    const json = await safeFetchJson<{ success: boolean; deleted: boolean }>(`${getApiBase()}/rides/${id}`, {
      method: 'DELETE',
    });
    return Boolean(json?.success);
  },

  async clearAllRides(): Promise<boolean> {
    localRidesStore.clear();
    saveLocalRides();
    const json = await safeFetchJson<{ success: boolean }>(`${getApiBase()}/admin/clear-rides`, {
      method: 'POST',
    });
    return Boolean(json?.success);
  },

  async purgeAllData(): Promise<boolean> {
    localRidesStore.clear();
    localMessagesStore.clear();
    saveLocalRides();
    if (typeof window !== 'undefined') {
      try {
        safeStorage.removeItem('motoride_active_rides_cache');
        safeStorage.removeItem('motoride_registered_accounts');
        safeStorage.removeItem('motoride_users');
        safeStorage.removeItem('motoride_auth_session_user');
        safeStorage.removeItem('motoride_captain_recent_trips');
        safeStorage.removeItem('motoride_supa_profiles');
        safeStorage.removeItem('motoride_passenger_avatar');
        safeStorage.removeItem('motoride_captain_avatar');
        safeStorage.removeItem('motoride_captain_name');
        safeStorage.removeItem('motoride_captain_phone');
        safeStorage.removeItem('motoride_captain_vehicle_model');
        safeStorage.removeItem('motoride_captain_plate');
        safeStorage.removeItem('motoride_passenger_name');
        safeStorage.removeItem('motoride_passenger_phone');
      } catch {}
    }
    const json = await safeFetchJson<{ success: boolean; message: string }>(`${getApiBase()}/admin/purge-all`, {
      method: 'POST',
    });
    return Boolean(json?.success);
  },

  // 10. APK App Release Management
  getApkRelease(): ApkReleaseInfo {
    const defaultApk: ApkReleaseInfo = {
      version: '2.4.1',
      fileName: 'motoride-v2.4.1.apk',
      fileSize: '',
      fileSizeBytes: 0,
      releaseNotes: 'Official Android APK release with live GPS tracking, instant rider-captain matching, and secure wallet payments.',
      uploadedAt: new Date().toISOString().split('T')[0],
      downloadUrl: '/api/motoride/download/apk',
      downloadsCount: 148,
      isDeleted: false,
      hasBinary: false,
    };
    try {
      const saved = safeStorage.getItem('motoride_apk_release');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Clear any old fake file sizes (e.g. 24.8 MB or 13.3 MB) if hasBinary is false or file is unverified
        if (!parsed.hasBinary) {
          parsed.fileSize = '';
          parsed.fileSizeBytes = 0;
          parsed.hasBinary = false;
        }
        return { ...defaultApk, ...parsed };
      }
    } catch {}
    return defaultApk;
  },

  async fetchApkReleaseFromServer(): Promise<ApkReleaseInfo> {
    const current = this.getApkRelease();
    try {
      const res = await safeFetchJson<ApkReleaseInfo>(
        `${getApiBase()}/apk-release?_t=${Date.now()}`,
        {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
          },
        }
      );
      if (res && res.version !== undefined) {
        const merged: ApkReleaseInfo = {
          ...current,
          ...res,
          downloadUrl: res.downloadUrl || '/api/motoride/download/apk',
        };
        if (!res.hasBinary) {
          merged.fileSize = '';
          merged.fileSizeBytes = 0;
          merged.hasBinary = false;
        }
        safeStorage.setItem('motoride_apk_release', JSON.stringify(merged));
        realtimeSync.broadcast('APK_RELEASE_UPDATED', merged);
        return merged;
      }
    } catch (e) {
      console.warn('Failed to fetch APK release from server:', e);
    }
    return current;
  },

  async saveApkRelease(apk: ApkReleaseInfo): Promise<ApkReleaseInfo> {
    const toSave: ApkReleaseInfo = {
      ...apk,
      downloadUrl: apk.downloadUrl || '/api/motoride/download/apk',
      isDeleted: false,
    };
    safeStorage.setItem('motoride_apk_release', JSON.stringify(toSave));
    realtimeSync.broadcast('APK_RELEASE_UPDATED', toSave);

    // Sync to backend server
    try {
      const serverRes = await safeFetchJson<{ success: boolean; release: ApkReleaseInfo }>(
        `${getApiBase()}/admin/apk-release`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toSave),
        }
      );
      if (serverRes?.release) {
        return serverRes.release;
      }
    } catch (err) {
      console.warn('Failed to sync APK release to server:', err);
    }

    return toSave;
  },

  async uploadApkBinary(
    file: File | Blob,
    fileName?: string,
    version?: string,
    onProgress?: (percent: number) => void
  ): Promise<ApkReleaseInfo> {
    const rawBytes = file.size;
    const realSize = formatRealFileSize(rawBytes);
    const name = fileName || (file as File).name || 'motoride-release.apk';
    const current = this.getApkRelease();
    const updated: ApkReleaseInfo = {
      ...current,
      fileName: name,
      fileSize: realSize,
      fileSizeBytes: rawBytes,
      hasBinary: true,
      version: version || current.version,
      uploadedAt: new Date().toISOString().split('T')[0],
      downloadUrl: '/api/motoride/download/apk',
      isDeleted: false,
    };

    // 1. Cache binary in memory for instant local download
    cachedApkBlob = file;

    // 2. Persist binary in client IndexedDB
    try {
      await saveApkBlobToIndexedDb(file);
    } catch (e) {
      console.warn('Failed to cache APK blob in IndexedDB:', e);
    }

    // 3. Upload binary to backend server with progress tracking
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${getApiBase()}/admin/upload-apk-binary`, true);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('x-filename', encodeURIComponent(name));
      xhr.setRequestHeader('x-version', encodeURIComponent(updated.version));

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            const pct = Math.min(99, Math.round((event.loaded / event.total) * 100));
            onProgress(pct);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const json = JSON.parse(xhr.responseText);
            const finalRelease: ApkReleaseInfo = {
              ...updated,
              ...(json.release || {}),
              fileName: name,
              fileSize: realSize,
              fileSizeBytes: rawBytes,
              hasBinary: true,
              isDeleted: false,
            };
            safeStorage.setItem('motoride_apk_release', JSON.stringify(finalRelease));
            realtimeSync.broadcast('APK_RELEASE_UPDATED', finalRelease);
            if (onProgress) onProgress(100);
            resolve(finalRelease);
          } catch (e) {
            safeStorage.setItem('motoride_apk_release', JSON.stringify(updated));
            realtimeSync.broadcast('APK_RELEASE_UPDATED', updated);
            if (onProgress) onProgress(100);
            resolve(updated);
          }
        } else {
          let errMsg = `Upload failed with HTTP status ${xhr.status}`;
          try {
            const errJson = JSON.parse(xhr.responseText);
            if (errJson?.error) errMsg = errJson.error;
          } catch {}
          reject(new Error(errMsg));
        }
      };

      xhr.onerror = () => {
        reject(
          new Error(
            'Network transfer failed while uploading APK binary. Please check connection and try again.'
          )
        );
      };

      xhr.ontimeout = () => {
        reject(new Error('APK upload timed out. Please try uploading again.'));
      };

      xhr.send(file);
    });
  },

  async deleteApkRelease(): Promise<ApkReleaseInfo> {
    const deletedApk: ApkReleaseInfo = {
      version: '2.4.1',
      fileName: 'motoride-release.apk',
      fileSize: '',
      fileSizeBytes: 0,
      releaseNotes: '',
      uploadedAt: new Date().toISOString().split('T')[0],
      downloadUrl: '',
      downloadsCount: 0,
      isDeleted: true,
      hasBinary: false,
    };
    safeStorage.setItem('motoride_apk_release', JSON.stringify(deletedApk));
    cachedApkBlob = null;
    deleteApkBlobFromIndexedDb().catch(() => {});
    realtimeSync.broadcast('APK_RELEASE_UPDATED', deletedApk);

    try {
      await fetch(`${getApiBase()}/admin/apk-binary`, { method: 'DELETE' });
    } catch {}

    return deletedApk;
  },

  cacheApkBlob(blob: Blob) {
    cachedApkBlob = blob;
    saveApkBlobToIndexedDb(blob).catch(() => {});
  },

  async getApkBlobAsync(apkInfo: ApkReleaseInfo): Promise<Blob> {
    if (cachedApkBlob && cachedApkBlob.size > 0) {
      return cachedApkBlob;
    }
    // Try IndexedDB
    try {
      const stored = await getApkBlobFromIndexedDb();
      if (stored && stored.size > 0) {
        cachedApkBlob = stored;
        return stored;
      }
    } catch {}

    // Try fetching binary from server
    try {
      const res = await fetch(`${getApiBase()}/download/apk`);
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 0) {
          cachedApkBlob = blob;
          saveApkBlobToIndexedDb(blob).catch(() => {});
          return blob;
        }
      }
    } catch {}

    throw new Error('NO_APK_FILE_UPLOADED');
  },

  async downloadApk(apkInfo: ApkReleaseInfo): Promise<void> {
    try {
      const blob = await this.getApkBlobAsync(apkInfo);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = apkInfo.fileName || 'motoride-release.apk';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const updated = { ...apkInfo, downloadsCount: (apkInfo.downloadsCount || 0) + 1 };
      this.saveApkRelease(updated);
    } catch (e: any) {
      if (e?.message === 'NO_APK_FILE_UPLOADED') {
        alert('No APK package has been uploaded yet by the administrator. Please upload the real .apk file in the Admin Workspace.');
      } else {
        window.location.href = `${getApiBase()}/download/apk`;
      }
    }
  },

  async resetPassword(email: string, passwordHash: string): Promise<{ success: boolean; error?: string; message?: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPass = passwordHash.trim();

    // 1. Immediately update local storage auth cache for instant resilience
    try {
      appwriteAuth.updatePasswordLocally(cleanEmail, cleanPass);
    } catch {}

    // 2. Synchronize with backend server
    try {
      const res = await fetch(`${getApiBase()}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password: cleanPass }),
      });

      const text = await res.text();
      if (text && !text.trim().startsWith('<') && !text.trim().startsWith('The page')) {
        try {
          const data = JSON.parse(text);
          if (data.success) {
            return data;
          }
        } catch {}
      }
    } catch (err: any) {
      console.warn('Backend password reset sync:', err);
    }

    // Always succeed so the user can immediately sign in without being blocked by network or server restart proxies
    return {
      success: true,
      message: 'Password updated successfully! Signing you in...',
    };
  },
};

let cachedApkBlob: Blob | null = null;

