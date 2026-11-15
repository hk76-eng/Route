export type GoogleMapLayerType =
  | 'google-street'
  | 'google-satellite'
  | 'google-terrain'
  | 'voyager-dark';

export interface GoogleMapLayerMeta {
  id: GoogleMapLayerType;
  label: string;
  shortLabel: string;
  tooltip: string;
  mapTypeId: 'roadmap' | 'satellite' | 'terrain';
  colorScheme: 'LIGHT' | 'DARK';
}

export const GOOGLE_MAPS_ATTRIBUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';
export const GOOGLE_MAPS_DEMO_MAP_ID = 'DEMO_MAP_ID';

export const GOOGLE_MAP_LAYERS: Record<GoogleMapLayerType, GoogleMapLayerMeta> = {
  'google-street': {
    id: 'google-street',
    label: 'Google Streets',
    shortLabel: 'Streets',
    tooltip: 'Google Maps Streets / Roadmap (Default)',
    mapTypeId: 'roadmap',
    colorScheme: 'LIGHT',
  },
  'google-satellite': {
    id: 'google-satellite',
    label: 'Google Satellite',
    shortLabel: 'Satellite',
    tooltip: 'Google Maps Satellite Imagery',
    mapTypeId: 'satellite',
    colorScheme: 'DARK',
  },
  'google-terrain': {
    id: 'google-terrain',
    label: 'Google Terrain',
    shortLabel: 'Terrain',
    tooltip: 'Google Maps Topographic Terrain & Relief',
    mapTypeId: 'terrain',
    colorScheme: 'LIGHT',
  },
  'voyager-dark': {
    id: 'voyager-dark',
    label: 'Voyager Dark',
    shortLabel: 'Dark',
    tooltip: 'Google Maps Voyager Dark Night Style',
    mapTypeId: 'roadmap',
    colorScheme: 'DARK',
  },
};

export function getGoogleMapsApiKey(): string {
  try {
    const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
    const key = meta.env?.VITE_GOOGLE_MAPS_API_KEY;
    if (typeof key === 'string' && key.trim() !== '') {
      return key.trim();
    }
  } catch {
    // Ignore env read errors
  }
  return '';
}

export function isGmpQuotaError(errOrStatus: unknown): boolean {
  if (!errOrStatus) return false;
  const text =
    typeof errOrStatus === 'string'
      ? errOrStatus
      : errOrStatus instanceof Error
      ? `${errOrStatus.name} ${errOrStatus.message}`
      : JSON.stringify(errOrStatus);

  const upper = text.toUpperCase();
  return (
    upper.includes('429') ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('OVER_QUERY_LIMIT') ||
    upper.includes('OVERQUOTAMAPERROR') ||
    upper.includes('QUOTAEXCEEDEDERROR') ||
    upper.includes('QUOTA EXCEEDED') ||
    upper.includes('EXCEEDED YOUR DAILY REQUEST QUOTA')
  );
}

export function dispatchGmpQuotaExceeded(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
}

export function checkAndDispatchGmpQuotaError(errOrStatus: unknown): boolean {
  if (isGmpQuotaError(errOrStatus)) {
    dispatchGmpQuotaExceeded();
    return true;
  }
  return false;
}
