import React, { useState, useEffect } from 'react';
import {
  X,
  Database,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Server,
  Key,
  Layers,
  FolderArchive,
} from 'lucide-react';
import {
  appwriteEndpoint,
  appwriteProjectId,
  appwriteDatabaseId,
  appwriteBucketId,
  appwriteBucketName,
  isAppwriteConfigured,
  saveAppwriteConfig,
  resetAppwriteConfigToDefault,
  testAppwriteConnection,
} from '../../lib/appwrite';
import { ensureMediaBucketExists } from '../../lib/appwriteStorage';
import { APPWRITE_SCHEMA_SPEC_JSON, APPWRITE_COLLECTIONS } from '../../lib/appwriteSchema';

interface AppwriteConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AppwriteConfigModal: React.FC<AppwriteConfigModalProps> = ({ isOpen, onClose }) => {
  const [endpoint, setEndpoint] = useState(appwriteEndpoint);
  const [projectId, setProjectId] = useState(appwriteProjectId);
  const [databaseId, setDatabaseId] = useState(appwriteDatabaseId);
  const [bucketId, setBucketId] = useState(appwriteBucketId);
  const [bucketName, setBucketName] = useState(appwriteBucketName);

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);

  const [bucketStatus, setBucketStatus] = useState<string | null>(null);
  const [isTestingBucket, setIsTestingBucket] = useState(false);

  const [copiedEnv, setCopiedEnv] = useState(false);
  const [copiedSchema, setCopiedSchema] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setEndpoint(appwriteEndpoint);
      setProjectId(appwriteProjectId);
      setDatabaseId(appwriteDatabaseId);
      setBucketId(appwriteBucketId);
      setBucketName(appwriteBucketName);
      setSaveMessage(null);
      // Auto test connection on open
      runConnectionTest();
    }
  }, [isOpen]);

  const runConnectionTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testAppwriteConnection();
      setTestResult(res);
    } catch (e: any) {
      setTestResult({
        success: false,
        message: e?.message || 'Connection test failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestBucket = async () => {
    setIsTestingBucket(true);
    try {
      const status = await ensureMediaBucketExists();
      setBucketStatus(status.message);
    } catch (err: any) {
      setBucketStatus(err?.message || 'Failed to verify bucket');
    } finally {
      setIsTestingBucket(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveAppwriteConfig({
      endpoint: endpoint.trim(),
      projectId: projectId.trim(),
      databaseId: databaseId.trim(),
      bucketId: bucketId.trim(),
      bucketName: bucketName.trim(),
    });
    setSaveMessage('Appwrite environment variables & bucket settings updated!');
    setTimeout(() => {
      runConnectionTest();
    }, 200);
  };

  const handleReset = () => {
    resetAppwriteConfigToDefault();
    setEndpoint(appwriteEndpoint);
    setProjectId(appwriteProjectId);
    setDatabaseId(appwriteDatabaseId);
    setBucketId(appwriteBucketId);
    setBucketName(appwriteBucketName);
    setSaveMessage('Reset to default Appwrite configuration');
    setTimeout(() => {
      runConnectionTest();
    }, 200);
  };

  const envSnippet = `# Appwrite Cloud Backend Configuration
VITE_APPWRITE_ENDPOINT=${endpoint}
VITE_APPWRITE_PROJECT_ID=${projectId}
VITE_APPWRITE_DATABASE_ID=${databaseId}
VITE_APPWRITE_BUCKET_ID=${bucketId}
VITE_APPWRITE_BUCKET_NAME=${bucketName}`;

  const copyToClipboard = (text: string, type: 'env' | 'schema') => {
    navigator.clipboard.writeText(text);
    if (type === 'env') {
      setCopiedEnv(true);
      setTimeout(() => setCopiedEnv(false), 2000);
    } else {
      setCopiedSchema(true);
      setTimeout(() => setCopiedSchema(false), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-pink-500/20 to-indigo-500/20 border border-pink-500/30 text-pink-400 flex items-center justify-center font-bold text-lg shadow-inner">
              <Database className="w-5 h-5 text-pink-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-white">Appwrite Database & Configuration</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-pink-500/10 border border-pink-500/30 text-pink-300">
                  Cloud
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Shared database, auth, storage, and realtime across Passenger, Captain, and Admin apps
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Active Status Banner */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-3.5 h-3.5 rounded-full ${
                  testResult?.success ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span>Status:</span>
                  <span className={testResult?.success ? 'text-emerald-400' : 'text-amber-400'}>
                    {isTesting
                      ? 'Checking connection...'
                      : testResult?.success
                      ? 'Active & Reachable'
                      : 'Configured'}
                  </span>
                  {testResult?.latencyMs ? (
                    <span className="text-[10px] text-slate-400 font-mono">
                      ({testResult.latencyMs}ms)
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] text-slate-400 font-mono truncate max-w-sm">
                  Endpoint: {appwriteEndpoint}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={runConnectionTest}
              disabled={isTesting}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
              <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
            </button>
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                testResult.success
                  ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                  : 'bg-amber-950/40 border-amber-500/30 text-amber-300'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          {/* Active Storage Bucket Card */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <FolderArchive className="w-4 h-4 text-pink-400" />
                <span className="text-xs font-bold text-white">Appwrite Storage Bucket:</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-pink-500/10 border border-pink-500/30 text-pink-300">
                  {bucketName}
                </span>
                <code className="text-[11px] font-mono text-slate-400">({bucketId})</code>
              </div>
              <button
                type="button"
                onClick={handleTestBucket}
                disabled={isTestingBucket}
                className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isTestingBucket ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3 text-pink-400" />}
                <span>{isTestingBucket ? 'Checking...' : 'Verify Bucket'}</span>
              </button>
            </div>
            {bucketStatus && (
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-pink-300 font-mono">
                {bucketStatus}
              </div>
            )}
          </div>

          {saveMessage && (
            <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-indigo-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-indigo-400" />
              <span>{saveMessage}</span>
            </div>
          )}

          {/* Configuration Form */}
          <form onSubmit={handleSave} className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-pink-400" />
                <span>Environment Variables & Credentials</span>
              </span>
              <button
                type="button"
                onClick={handleReset}
                className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer"
              >
                Reset to default
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-[11px] font-bold text-slate-400 block mb-1">
                  Appwrite API Endpoint
                </label>
                <input
                  type="text"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://fra.cloud.appwrite.io/v1"
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">
                  Appwrite Project ID
                </label>
                <input
                  type="text"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  placeholder="6ad0ec20000c3632117b"
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">
                  Database ID
                </label>
                <input
                  type="text"
                  value={databaseId}
                  onChange={(e) => setDatabaseId(e.target.value)}
                  placeholder="motoride_db"
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">
                  Storage Bucket ID
                </label>
                <input
                  type="text"
                  value={bucketId}
                  onChange={(e) => setBucketId(e.target.value)}
                  placeholder="6ad8dec90028274c8e3c"
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">
                  Storage Bucket Name
                </label>
                <input
                  type="text"
                  value={bucketName}
                  onChange={(e) => setBucketName(e.target.value)}
                  placeholder="route_media"
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-pink-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-bold text-xs shadow-md transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save & Apply</span>
              </button>
            </div>
          </form>

          {/* Quick Copy .env Snippet */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-indigo-400" />
                <span>Environment File Snippet (.env)</span>
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(envSnippet, 'env')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                {copiedEnv ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedEnv ? 'Copied!' : 'Copy .env'}</span>
              </button>
            </div>
            <pre className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono text-pink-300 overflow-x-auto">
              {envSnippet}
            </pre>
          </div>

          {/* Collections Blueprint */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                <span>Database Collections ({APPWRITE_COLLECTIONS.length} Collections)</span>
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(APPWRITE_SCHEMA_SPEC_JSON, 'schema')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                {copiedSchema ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedSchema ? 'Copied JSON!' : 'Copy Schema JSON'}</span>
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {APPWRITE_COLLECTIONS.map((c) => (
                <div key={c.id} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-[11px]">
                  <div className="font-bold text-white truncate">{c.name}</div>
                  <div className="text-slate-400 font-mono text-[10px]">{c.id} ({c.attributes.length} attrs)</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs">
          <a
            href="https://cloud.appwrite.io/console"
            target="_blank"
            rel="noopener noreferrer"
            className="text-pink-400 hover:text-pink-300 flex items-center gap-1 font-bold text-xs"
          >
            <span>Open Appwrite Cloud Console</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
