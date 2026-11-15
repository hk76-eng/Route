import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  CheckCircle2,
  Compass,
  Loader2,
  LocateFixed,
  MapPin,
  Moon,
  Mountain,
  Navigation,
  Satellite,
  Search,
  X,
} from 'lucide-react';
import { MotorideMap } from '../common/MotorideMap';
import {
  GOOGLE_MAP_LAYERS,
  GOOGLE_MAPS_ATTRIBUTION_ID,
  GOOGLE_MAPS_DEMO_MAP_ID,
  GoogleMapLayerType,
  checkAndDispatchGmpQuotaError,
  getGoogleMapsApiKey,
} from '../../utils/googleMapsConfig';

export interface LocationPickerGoogleMapModalProps {
  isOpen: boolean;
  mode: 'pickup' | 'dropoff';
  initialLat: number;
  initialLng: number;
  initialAddress?: string;
  otherPoint?: { lat: number; lng: number; address?: string } | null;
  passengerGps?: { lat: number; lng: number } | null;
  activeLayer: GoogleMapLayerType;
  onLayerChange: (layer: GoogleMapLayerType) => void;
  onConfirm: (loc: { name: string; lat: number; lng: number }) => void;
  onClose: () => void;
}

interface SearchResultItem {
  id: string;
  label: string;
  lat?: number;
  lng?: number;
  suggestion?: google.maps.places.AutocompleteSuggestion;
}

interface GoogleServicesHandles {
  map: google.maps.Map | null;
  placesLib: google.maps.PlacesLibrary | null;
  geocodingLib: google.maps.GeocodingLibrary | null;
}

const GoogleServicesSync: React.FC<{
  onReady: (handles: GoogleServicesHandles) => void;
}> = ({ onReady }) => {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const geocodingLib = useMapsLibrary('geocoding');

  useEffect(() => {
    onReady({ map, placesLib, geocodingLib });
  }, [map, placesLib, geocodingLib, onReady]);

  return null;
};

interface PickerBodyProps extends Omit<LocationPickerGoogleMapModalProps, 'isOpen'> {
  apiKey: string;
}

const LocationPickerBody: React.FC<PickerBodyProps> = ({
  apiKey,
  mode,
  initialLat,
  initialLng,
  initialAddress,
  otherPoint,
  passengerGps,
  activeLayer,
  onLayerChange,
  onConfirm,
  onClose,
}) => {
  const isPickup = mode === 'pickup';
  const layerMeta = GOOGLE_MAP_LAYERS[activeLayer] || GOOGLE_MAP_LAYERS['google-street'];

  const [services, setServices] = useState<GoogleServicesHandles>({
    map: null,
    placesLib: null,
    geocodingLib: null,
  });

  const [selectedLat, setSelectedLat] = useState<number>(initialLat);
  const [selectedLng, setSelectedLng] = useState<number>(initialLng);
  const [resolvedAddress, setResolvedAddress] = useState<string>(
    initialAddress?.trim() || `${initialLat.toFixed(5)}, ${initialLng.toFixed(5)}`
  );
  const [isResolvingAddress, setIsResolvingAddress] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [suggestions, setSuggestions] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);

  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const lastViewRef = useRef<{ center: google.maps.LatLngLiteral; zoom: number }>({
    center: { lat: initialLat, lng: initialLng },
    zoom: 16,
  });

  const reverseGeocodeCoords = useCallback(
    async (lat: number, lng: number) => {
      setIsResolvingAddress(true);
      try {
        if (apiKey && services.geocodingLib) {
          const geocoder = new services.geocodingLib.Geocoder();
          const { results } = await geocoder.geocode({ location: { lat, lng } });
          if (results && results.length > 0 && results[0].formatted_address) {
            setResolvedAddress(results[0].formatted_address);
            setIsResolvingAddress(false);
            return;
          }
        }
      } catch (err) {
        checkAndDispatchGmpQuotaError(err);
      }

      try {
        const res = await fetch(`/api/motoride/geocode/reverse?lat=${lat}&lng=${lng}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.name) {
            setResolvedAddress(data.name);
            setIsResolvingAddress(false);
            return;
          }
        }
      } catch {
        // Fallback below
      }

      setResolvedAddress(
        `${isPickup ? 'Pinned Pickup' : 'Pinned Drop-off'} (${lat.toFixed(4)}, ${lng.toFixed(4)})`
      );
      setIsResolvingAddress(false);
    },
    [apiKey, services.geocodingLib, isPickup]
  );

  useEffect(() => {
    if (!initialAddress?.trim()) {
      void reverseGeocodeCoords(initialLat, initialLng);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      if (apiKey && services.placesLib) {
        try {
          if (!sessionTokenRef.current) {
            sessionTokenRef.current = new services.placesLib.AutocompleteSessionToken();
          }
          const { suggestions: raw } =
            await services.placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
              input: q,
              sessionToken: sessionTokenRef.current,
              region: 'IN',
            });
          if (cancelled) return;
          const mapped: SearchResultItem[] = raw
            .filter((s) => Boolean(s.placePrediction))
            .map((s, idx) => ({
              id: s.placePrediction?.placeId || `gmp-${idx}`,
              label: s.placePrediction?.text.text || q,
              suggestion: s,
            }));
          setSuggestions(mapped);
          setIsSearching(false);
          return;
        } catch (err) {
          checkAndDispatchGmpQuotaError(err);
        }
      }

      try {
        const res = await fetch(`/api/motoride/geocode/search?q=${encodeURIComponent(q)}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (Array.isArray(data.results)) {
            setSuggestions(
              data.results.map((r: { name: string; lat: number; lng: number }, idx: number) => ({
                id: `srv-${idx}-${r.lat}-${r.lng}`,
                label: r.name,
                lat: r.lat,
                lng: r.lng,
              }))
            );
          }
        }
      } catch {
        // Ignore fallback error
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 320);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, apiKey, services.placesLib]);

  const moveSelectionTo = useCallback(
    (lat: number, lng: number, explicitLabel?: string) => {
      setSelectedLat(lat);
      setSelectedLng(lng);
      lastViewRef.current = { center: { lat, lng }, zoom: 16 };
      if (services.map) {
        services.map.panTo({ lat, lng });
        if ((services.map.getZoom() || 0) < 15) {
          services.map.setZoom(16);
        }
      }
      if (explicitLabel) {
        setResolvedAddress(explicitLabel);
      } else {
        void reverseGeocodeCoords(lat, lng);
      }
    },
    [services.map, reverseGeocodeCoords]
  );

  const handleSelectSuggestion = async (item: SearchResultItem) => {
    setShowDropdown(false);

    if (item.suggestion?.placePrediction) {
      try {
        const place = item.suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location', 'viewport'],
        });
        sessionTokenRef.current = null;

        const loc = place.location;
        if (loc) {
          const lat = loc.lat();
          const lng = loc.lng();
          const addressLabel =
            place.formattedAddress || place.displayName || item.label;
          setSearchQuery(addressLabel);
          moveSelectionTo(lat, lng, addressLabel);
          if (services.map && place.viewport) {
            services.map.fitBounds(place.viewport);
          }
          return;
        }
      } catch (err) {
        checkAndDispatchGmpQuotaError(err);
      }
    }

    if (item.lat != null && item.lng != null) {
      setSearchQuery(item.label);
      moveSelectionTo(item.lat, item.lng, item.label);
    }
  };

  const handleUseMyGps = () => {
    if (passengerGps) {
      moveSelectionTo(passengerGps.lat, passengerGps.lng);
    } else if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          moveSelectionTo(pos.coords.latitude, pos.coords.longitude);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
  };

  const handleConfirm = () => {
    onConfirm({
      name:
        resolvedAddress.trim() ||
        `${isPickup ? 'Pickup' : 'Drop-off'} (${selectedLat.toFixed(4)}, ${selectedLng.toFixed(4)})`,
      lat: selectedLat,
      lng: selectedLng,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[2200] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={isPickup ? 'Select Pickup Location on Google Map' : 'Select Drop-off Location on Google Map'}
    >
      <div className="relative w-full h-full sm:max-w-4xl sm:h-[88dvh] bg-white sm:rounded-3xl border-0 sm:border-2 sm:border-black shadow-2xl overflow-hidden flex flex-col text-black">
        {/* Top Header + Place Search Bar */}
        <div className="bg-white border-b border-black/15 px-3 sm:px-4 py-3 flex flex-col gap-2.5 z-20 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-white text-sm shadow shrink-0 ${
                  isPickup ? 'bg-emerald-600' : 'bg-rose-600'
                }`}
              >
                {isPickup ? 'A' : 'B'}
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-black text-black truncate">
                  {isPickup ? 'Pick Pickup Location (A) on Map' : 'Pick Drop-off Location (B) on Map'}
                </h2>
                <p className="text-[11px] text-slate-600 font-medium truncate">
                  Search any place, tap the map, or drag pin {isPickup ? 'A' : 'B'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-black border border-black/20 transition-colors cursor-pointer shrink-0"
              aria-label="Close Google Map Picker"
              title="Close"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>

          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder={
                  isPickup
                    ? 'Search pickup landmark, street, or sector on Google Maps...'
                    : 'Search destination landmark, market, or station on Google Maps...'
                }
                className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-slate-50 border border-black text-xs sm:text-sm font-semibold text-black placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-black"
              />
              {(isSearching || searchQuery) && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {isSearching && <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />}
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setSuggestions([]);
                      }}
                      className="p-0.5 rounded-md bg-slate-200 hover:bg-slate-300 text-black cursor-pointer"
                      aria-label="Clear search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {showDropdown && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border border-black rounded-xl shadow-2xl max-h-56 overflow-y-auto">
                  {suggestions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void handleSelectSuggestion(item)}
                      className="w-full px-3 py-2.5 text-left text-xs text-slate-800 hover:bg-slate-100 hover:text-black flex items-center gap-2 border-b border-slate-200 last:border-0 cursor-pointer transition-colors"
                    >
                      {isPickup ? (
                        <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <Navigation className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      )}
                      <span className="truncate font-semibold">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {passengerGps && (
              <button
                type="button"
                onClick={handleUseMyGps}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-black text-white font-bold text-xs whitespace-nowrap shrink-0 cursor-pointer active:scale-95 transition-all"
                title="Use my current live GPS location"
              >
                <LocateFixed className="w-4 h-4 text-emerald-400" />
                <span className="hidden sm:inline">My GPS</span>
              </button>
            )}
          </div>
        </div>

        {/* Full-Bleed Map Area */}
        <div className="relative flex-1 w-full min-h-[280px] bg-slate-200">
          {apiKey ? (
            <GoogleMap
              key={`picker-gmp-${layerMeta.colorScheme}`}
              className="w-full h-full"
              defaultCenter={lastViewRef.current.center}
              defaultZoom={lastViewRef.current.zoom}
              mapId={GOOGLE_MAPS_DEMO_MAP_ID}
              mapTypeId={layerMeta.mapTypeId}
              colorScheme={layerMeta.colorScheme}
              internalUsageAttributionIds={[GOOGLE_MAPS_ATTRIBUTION_ID]}
              gestureHandling="greedy"
              disableDefaultUI={true}
              zoomControl={true}
              onCameraChanged={(ev) => {
                lastViewRef.current = {
                  center: ev.detail.center,
                  zoom: ev.detail.zoom,
                };
              }}
              onClick={(ev) => {
                setShowDropdown(false);
                if (ev.detail.latLng) {
                  moveSelectionTo(ev.detail.latLng.lat, ev.detail.latLng.lng);
                }
              }}
            >
              <GoogleServicesSync onReady={setServices} />

              <AdvancedMarker
                position={{ lat: selectedLat, lng: selectedLng }}
                draggable={true}
                zIndex={3000}
                onDragEnd={(ev) => {
                  if (ev.latLng) {
                    moveSelectionTo(ev.latLng.lat(), ev.latLng.lng());
                  }
                }}
                title={isPickup ? 'Drag Pickup Pin (A)' : 'Drag Drop-off Pin (B)'}
              >
                <div className="flex flex-col items-center cursor-grab active:cursor-grabbing select-none">
                  <div
                    className={`px-2.5 py-0.5 mb-1 rounded-md bg-slate-950 font-black text-[11px] border shadow-xl whitespace-nowrap ${
                      isPickup
                        ? 'text-emerald-400 border-emerald-500'
                        : 'text-rose-400 border-rose-500'
                    }`}
                  >
                    {isPickup ? 'A • PICKUP' : 'B • DROPOFF'}
                  </div>
                  <div className="relative flex items-center justify-center">
                    <div
                      className={`w-9 h-9 rounded-full text-white flex items-center justify-center font-black text-base border-2 border-white shadow-xl ${
                        isPickup ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    >
                      {isPickup ? 'A' : 'B'}
                    </div>
                    <div
                      className={`w-2.5 h-2.5 rotate-45 -bottom-1 absolute border-r-2 border-b-2 border-white ${
                        isPickup ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />
                  </div>
                </div>
              </AdvancedMarker>

              {otherPoint && (
                <AdvancedMarker
                  position={{ lat: otherPoint.lat, lng: otherPoint.lng }}
                  zIndex={1200}
                  title={otherPoint.address || (isPickup ? 'Drop-off (B)' : 'Pickup (A)')}
                >
                  <div className="flex flex-col items-center opacity-80 select-none">
                    <div
                      className={`w-7 h-7 rounded-full text-white flex items-center justify-center font-black text-xs border-2 border-white shadow ${
                        isPickup ? 'bg-rose-500' : 'bg-emerald-500'
                      }`}
                    >
                      {isPickup ? 'B' : 'A'}
                    </div>
                  </div>
                </AdvancedMarker>
              )}
            </GoogleMap>
          ) : (
            <MotorideMap
              pickupLat={isPickup ? selectedLat : otherPoint?.lat ?? null}
              pickupLng={isPickup ? selectedLng : otherPoint?.lng ?? null}
              pickupAddress={isPickup ? resolvedAddress : otherPoint?.address || ''}
              dropoffLat={!isPickup ? selectedLat : otherPoint?.lat ?? null}
              dropoffLng={!isPickup ? selectedLng : otherPoint?.lng ?? null}
              dropoffAddress={!isPickup ? resolvedAddress : otherPoint?.address || ''}
              passengerLat={passengerGps?.lat}
              passengerLng={passengerGps?.lng}
              interactive={true}
              onMapClick={(lat, lng) => moveSelectionTo(lat, lng)}
              initialLayer={activeLayer}
              onLayerChange={onLayerChange}
              showOverlayControls={false}
              className="w-full h-full"
            />
          )}

          {/* Layer Switcher Floating Bar in Top Right of Modal Map */}
          <div className="absolute top-3 right-3 z-[400] flex items-center p-1 rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200/90 shadow-lg">
            <button
              type="button"
              onClick={() => onLayerChange('google-street')}
              className={`flex items-center gap-1 px-2 py-1 rounded-xl text-[11px] font-bold cursor-pointer whitespace-nowrap shrink-0 ${
                activeLayer === 'google-street'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Compass className="w-3 h-3" />
              <span className="hidden sm:inline">Streets</span>
            </button>
            <button
              type="button"
              onClick={() => onLayerChange('google-satellite')}
              className={`flex items-center gap-1 px-2 py-1 rounded-xl text-[11px] font-bold cursor-pointer whitespace-nowrap shrink-0 ${
                activeLayer === 'google-satellite'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Satellite className="w-3 h-3" />
              <span className="hidden sm:inline">Satellite</span>
            </button>
            <button
              type="button"
              onClick={() => onLayerChange('google-terrain')}
              className={`flex items-center gap-1 px-2 py-1 rounded-xl text-[11px] font-bold cursor-pointer whitespace-nowrap shrink-0 ${
                activeLayer === 'google-terrain'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Mountain className="w-3 h-3" />
              <span className="hidden sm:inline">Terrain</span>
            </button>
            <button
              type="button"
              onClick={() => onLayerChange('voyager-dark')}
              className={`flex items-center gap-1 px-2 py-1 rounded-xl text-[11px] font-bold cursor-pointer whitespace-nowrap shrink-0 ${
                activeLayer === 'voyager-dark'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Moon className="w-3 h-3" />
              <span className="hidden sm:inline">Dark</span>
            </button>
          </div>
        </div>

        {/* Bottom Confirmation Bar */}
        <div className="bg-white border-t border-black/15 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${
                  isPickup
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                    : 'bg-rose-50 text-rose-800 border-rose-300'
                }`}
              >
                {isPickup ? 'PICKUP (A)' : 'DROP-OFF (B)'}
              </span>
              <span className="text-[11px] font-mono-num text-slate-500">
                {selectedLat.toFixed(5)}, {selectedLng.toFixed(5)}
              </span>
            </div>
            <div className="text-xs sm:text-sm font-black text-black truncate mt-1 flex items-center gap-1.5">
              {isResolvingAddress ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500 shrink-0" />
                  <span className="text-slate-500 font-semibold">Resolving address...</span>
                </>
              ) : (
                <span className="truncate">{resolvedAddress}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-black border border-black/30 text-xs font-bold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isResolvingAddress}
              className={`px-5 py-2.5 rounded-xl text-white font-black text-xs sm:text-sm flex items-center gap-2 shadow-lg cursor-pointer active:scale-95 transition-all disabled:opacity-60 ${
                isPickup
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-rose-600 hover:bg-rose-700'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
              <span>{isPickup ? 'Confirm Pickup Location' : 'Confirm Drop-off Location'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const LocationPickerGoogleMapModal: React.FC<LocationPickerGoogleMapModalProps> = (
  props
) => {
  const apiKey = useMemo(() => getGoogleMapsApiKey(), []);
  if (!props.isOpen) return null;

  if (!apiKey) {
    return <LocationPickerBody {...props} apiKey="" />;
  }

  return (
    <APIProvider apiKey={apiKey} language="en" region="IN">
      <LocationPickerBody {...props} apiKey={apiKey} />
    </APIProvider>
  );
};
