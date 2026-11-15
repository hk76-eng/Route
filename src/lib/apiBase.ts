import { safeStorage } from './safeStorage';

let staticHostNoBackend = false;

/**
 * Resolves the Motoride API base URL cleanly:
 * - Honors `localStorage.motoride_api_base_url` or `VITE_API_BASE_URL` if provided (important when frontend is hosted statically on Appwrite Sites while Node API lives separately).
 * - Otherwise defaults to relative `/api/motoride`.
 */
export function resolveMotorideApiBase(): string {
  try {
    const saved = safeStorage.getItem('motoride_api_base_url');
    const envVal = (import.meta as any).env?.VITE_API_BASE_URL as string | undefined;
    const raw = (saved && saved.trim()) || (envVal && envVal.trim()) || '';
    if (raw) {
      const cleaned = raw.replace(/\/+$/, '');
      return cleaned.endsWith('/api/motoride') ? cleaned : `${cleaned}/api/motoride`;
    }
  } catch {}
  return '/api/motoride';
}

export function hasCustomBackendUrl(): boolean {
  return resolveMotorideApiBase() !== '/api/motoride';
}

export function isStaticBackendUnavailable(): boolean {
  return staticHostNoBackend && !hasCustomBackendUrl();
}

export function markStaticBackendUnavailable(): void {
  if (!hasCustomBackendUrl()) {
    staticHostNoBackend = true;
  }
}

export function resetStaticBackendFlag(): void {
  staticHostNoBackend = false;
}
