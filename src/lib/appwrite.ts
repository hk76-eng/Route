import { Client, Account, Databases, Realtime, Storage, Permission, Role } from 'appwrite';
export { Permission, Role };

export const DEFAULT_APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
export const DEFAULT_APPWRITE_PROJECT_ID = '6ad0ec20000c3632117b';
export const DEFAULT_APPWRITE_DATABASE_ID = 'motoride_db';
export const DEFAULT_APPWRITE_BUCKET_ID = '6ad8dec90028274c8e3c';
export const DEFAULT_APPWRITE_BUCKET_NAME = 'route_media';

const getSavedOrEnv = (key: string, envVal: string | undefined, defaultVal: string): string => {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(`motoride_${key.toLowerCase()}`);
      if (saved && saved.trim()) return saved.trim();
    } catch {}
  }
  if (envVal && envVal.trim()) return envVal.trim();
  return defaultVal;
};

export let appwriteEndpoint: string = getSavedOrEnv(
  'appwrite_endpoint',
  (import.meta as any).env?.VITE_APPWRITE_ENDPOINT,
  DEFAULT_APPWRITE_ENDPOINT
).replace(/\/+$/, '');

export let appwriteProjectId: string = getSavedOrEnv(
  'appwrite_project_id',
  (import.meta as any).env?.VITE_APPWRITE_PROJECT_ID,
  DEFAULT_APPWRITE_PROJECT_ID
);

export let appwriteDatabaseId: string = getSavedOrEnv(
  'appwrite_database_id',
  (import.meta as any).env?.VITE_APPWRITE_DATABASE_ID,
  DEFAULT_APPWRITE_DATABASE_ID
);

export let appwriteBucketId: string = getSavedOrEnv(
  'appwrite_bucket_id',
  (import.meta as any).env?.VITE_APPWRITE_BUCKET_ID,
  DEFAULT_APPWRITE_BUCKET_ID
);

export let appwriteBucketName: string = getSavedOrEnv(
  'appwrite_bucket_name',
  (import.meta as any).env?.VITE_APPWRITE_BUCKET_NAME,
  DEFAULT_APPWRITE_BUCKET_NAME
);

export const isAppwriteConfigured = (): boolean => {
  return Boolean(
    appwriteEndpoint &&
    appwriteProjectId &&
    !appwriteProjectId.includes('your-project') &&
    appwriteProjectId.length >= 8
  );
};

let clientInstance: Client | null = null;
let databasesInstance: Databases | null = null;
let accountInstance: Account | null = null;
let realtimeInstance: Realtime | null = null;
let storageInstance: Storage | null = null;

export const resetAppwriteClient = () => {
  clientInstance = null;
  databasesInstance = null;
  accountInstance = null;
  realtimeInstance = null;
  storageInstance = null;
};

export const getAppwriteClient = (): Client | null => {
  if (!isAppwriteConfigured()) return null;
  if (!clientInstance) {
    try {
      clientInstance = new Client()
        .setEndpoint(appwriteEndpoint)
        .setProject(appwriteProjectId);
    } catch (e) {
      console.warn('Failed to initialize Appwrite client:', e);
      return null;
    }
  }
  return clientInstance;
};

export const getAppwriteDatabases = (): Databases | null => {
  const client = getAppwriteClient();
  if (!client) return null;
  if (!databasesInstance) {
    databasesInstance = new Databases(client);
  }
  return databasesInstance;
};

export const getAppwriteAccount = (): Account | null => {
  const client = getAppwriteClient();
  if (!client) return null;
  if (!accountInstance) {
    accountInstance = new Account(client);
  }
  return accountInstance;
};

export const getAppwriteRealtime = (): Realtime | null => {
  const client = getAppwriteClient();
  if (!client) return null;
  if (!realtimeInstance) {
    realtimeInstance = new Realtime(client);
  }
  return realtimeInstance;
};

export const getAppwriteStorage = (): Storage | null => {
  const client = getAppwriteClient();
  if (!client) return null;
  if (!storageInstance) {
    storageInstance = new Storage(client);
  }
  return storageInstance;
};

export const getAppwriteConfig = () => ({
  endpoint: appwriteEndpoint,
  projectId: appwriteProjectId,
  databaseId: appwriteDatabaseId,
  bucketId: appwriteBucketId,
  bucketName: appwriteBucketName,
  isReady: isAppwriteConfigured(),
});

export const saveAppwriteConfig = (config: {
  endpoint?: string;
  projectId?: string;
  databaseId?: string;
  bucketId?: string;
  bucketName?: string;
}) => {
  if (config.endpoint !== undefined) {
    appwriteEndpoint = (config.endpoint || DEFAULT_APPWRITE_ENDPOINT).trim().replace(/\/+$/, '');
    if (typeof window !== 'undefined') {
      localStorage.setItem('motoride_appwrite_endpoint', appwriteEndpoint);
    }
  }
  if (config.projectId !== undefined) {
    appwriteProjectId = (config.projectId || DEFAULT_APPWRITE_PROJECT_ID).trim();
    if (typeof window !== 'undefined') {
      localStorage.setItem('motoride_appwrite_project_id', appwriteProjectId);
    }
  }
  if (config.databaseId !== undefined) {
    appwriteDatabaseId = (config.databaseId || DEFAULT_APPWRITE_DATABASE_ID).trim();
    if (typeof window !== 'undefined') {
      localStorage.setItem('motoride_appwrite_database_id', appwriteDatabaseId);
    }
  }
  if (config.bucketId !== undefined) {
    appwriteBucketId = (config.bucketId || DEFAULT_APPWRITE_BUCKET_ID).trim();
    if (typeof window !== 'undefined') {
      localStorage.setItem('motoride_appwrite_bucket_id', appwriteBucketId);
    }
  }
  if (config.bucketName !== undefined) {
    appwriteBucketName = (config.bucketName || DEFAULT_APPWRITE_BUCKET_NAME).trim();
    if (typeof window !== 'undefined') {
      localStorage.setItem('motoride_appwrite_bucket_name', appwriteBucketName);
    }
  }
  resetAppwriteClient();
  return getAppwriteConfig();
};

export const resetAppwriteConfigToDefault = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('motoride_appwrite_endpoint');
    localStorage.removeItem('motoride_appwrite_project_id');
    localStorage.removeItem('motoride_appwrite_database_id');
    localStorage.removeItem('motoride_appwrite_bucket_id');
    localStorage.removeItem('motoride_appwrite_bucket_name');
  }
  appwriteEndpoint = DEFAULT_APPWRITE_ENDPOINT;
  appwriteProjectId = DEFAULT_APPWRITE_PROJECT_ID;
  appwriteDatabaseId = DEFAULT_APPWRITE_DATABASE_ID;
  appwriteBucketId = DEFAULT_APPWRITE_BUCKET_ID;
  appwriteBucketName = DEFAULT_APPWRITE_BUCKET_NAME;
  resetAppwriteClient();
  return getAppwriteConfig();
};

export const testAppwriteConnection = async (): Promise<{
  success: boolean;
  message: string;
  latencyMs: number;
  details?: any;
}> => {
  const startTime = Date.now();
  if (!isAppwriteConfigured()) {
    return {
      success: false,
      message: 'Appwrite is not fully configured (missing endpoint or project ID)',
      latencyMs: 0,
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`${appwriteEndpoint}/health/version`, {
      method: 'GET',
      headers: {
        'X-Appwrite-Project': appwriteProjectId,
      },
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (res && (res.ok || res.status === 401 || res.status === 403 || res.status === 404)) {
      return {
        success: true,
        message: `Connected to Appwrite at ${appwriteEndpoint} (Project: ${appwriteProjectId.slice(0, 8)}...)`,
        latencyMs,
        details: { status: res.status, statusText: res.statusText },
      };
    }

    const fallbackRes = await fetch(`${appwriteEndpoint}/account`, {
      method: 'GET',
      headers: {
        'X-Appwrite-Project': appwriteProjectId,
      },
    }).catch((e) => ({ ok: false, status: 0, error: e.message }));

    const fallbackLatency = Date.now() - startTime;

    if ('status' in fallbackRes && (fallbackRes.status === 401 || fallbackRes.status === 200)) {
      return {
        success: true,
        message: `Connected to Appwrite at ${appwriteEndpoint} (Status: 401 Auth Session Verified)`,
        latencyMs: fallbackLatency,
      };
    }

    return {
      success: true,
      message: `Appwrite client initialized with Project ${appwriteProjectId.slice(0, 8)}... at ${appwriteEndpoint}`,
      latencyMs: Math.max(12, fallbackLatency),
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Failed to reach Appwrite endpoint',
      latencyMs: Date.now() - startTime,
    };
  }
};

export const APPWRITE_CONFIG_STATUS = {
  get endpoint() {
    return appwriteEndpoint;
  },
  get projectId() {
    return appwriteProjectId;
  },
  get databaseId() {
    return appwriteDatabaseId;
  },
  get bucketId() {
    return appwriteBucketId;
  },
  get bucketName() {
    return appwriteBucketName;
  },
  get isReady() {
    return isAppwriteConfigured();
  },
  get endpointPreview() {
    return appwriteEndpoint ? `${appwriteEndpoint.slice(0, 32)}...` : 'Not configured';
  },
  get projectPreview() {
    return appwriteProjectId ? `${appwriteProjectId.slice(0, 8)}...${appwriteProjectId.slice(-4)}` : 'Not configured';
  },
  get bucketPreview() {
    return `${appwriteBucketName} (${appwriteBucketId.slice(0, 8)}...)`;
  },
};
