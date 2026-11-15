import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Compass, Crosshair, Moon, Mountain, Navigation, Satellite } from 'lucide-react';
import { AvailableCaptainItem, MotorideMap } from '../common/MotorideMap';
import {
  GOOGLE_MAP_LAYERS,
  GOOGLE_MAPS_ATTRIBUTION_ID,
  GOOGLE_MAPS_DEMO_MAP_ID,
  GoogleMapLayerType,
  checkAndDispatchGmpQuotaError,
  getGoogleMapsApiKey,
} from '../../utils/googleMapsConfig';
import { calculateHaversineDistanceKm } from '../../utils/distanceCalculator';

interface PassengerGoogleMapProps {
  pickupLat?: number | null;
  pickupLng?: number | null;
  pickupAddress?: string;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  dropoffAddress?: string;
  pickupDistanceText?: string;
  dropoffDistanceText?: string;
  captainLat?: number | null;
  captainLng?: number | null;
  captainHeading?: number;
  captainAccuracy?: number | null;
  captainName?: string;
  passengerLat?: number | null;
  passengerLng?: number | null;
  passengerAccuracy?: number | null;
  passengerName?: string;
  showLocationsABOnly?: boolean;
  bottomSheetPadding?: number;
  isLiveGpsActive?: boolean;
  onLocateMe?: () => void;
  onSetPickupToPassengerLocation?: (lat: number, lng: number) => void;
  interactive?: boolean;
  onMapClick?: (lat: number, lng: number) => void;
  className?: string;
  activeLayer: GoogleMapLayerType;
  onLayerChange: (layer: GoogleMapLayerType) => void;
  showOverlayControls?: boolean;
  nearbyCaptains?: AvailableCaptainItem[];
  nearestCaptain?: AvailableCaptainItem | null;
  onSelectCaptain?: (captain: AvailableCaptainItem) => void;
  activeRideStatus?: string | null;
}

const DEFAULT_CENTER = { lat: 30.704649, lng: 76.717873 };

interface MapControllerProps {
  pickupLat?: number | null;
  pickupLng?: number | null;
  pickupAddress?: string;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  dropoffAddress?: string;
  captainLat?: number | null;
  captainLng?: number | null;
  passengerLat?: number | null;
  passengerLng?: number | null;
  showLocationsABOnly?: boolean;
  bottomSheetPadding?: number;
  activeRideStatus?: string | null;
  isFollowingPassenger: boolean;
  recenterSignal: number;
  focusTarget: { lat: number; lng: number; zoom?: number; nonce: number } | null;
}

const PassengerMapRouteAndCameraController: React.FC<MapControllerProps> = ({
  pickupLat,
  pickupLng,
  pickupAddress,
  dropoffLat,
  dropoffLng,
  dropoffAddress,
  captainLat,
  captainLng,
  passengerLat,
  passengerLng,
  showLocationsABOnly,
  bottomSheetPadding,
  activeRideStatus,
  isFollowingPassenger,
  recenterSignal,
  focusTarget,
}) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const routePolylineRef = useRef<google.maps.Polyline | null>(null);
  const routeGlowRef = useRef<google.maps.Polyline | null>(null);
  const guideLineRef = useRef<google.maps.Polyline | null>(null);
  const walkLineRef = useRef<google.maps.Polyline | null>(null);
  const lastComputedRouteKeyRef = useRef<string>('');
  const lastFittedBoundsKeyRef = useRef<string>('');
  const routePathCacheRef = useRef<Map<string, google.maps.LatLngLiteral[]>>(new Map());

  const hasPickup = Boolean(pickupLat && pickupLng && pickupAddress && pickupAddress.trim() !== '');
  const hasDropoff = Boolean(dropoffLat && dropoffLng && dropoffAddress && dropoffAddress.trim() !== '');

  // Draw / compute A -> B route via Maps JS SDK Routes API with local coordinate cache & geodesic fallback
  useEffect(() => {
    if (!map) return;

    const clearRoutePolylines = () => {
      if (routePolylineRef.current) {
        routePolylineRef.current.setMap(null);
        routePolylineRef.current = null;
      }
      if (routeGlowRef.current) {
        routeGlowRef.current.setMap(null);
        routeGlowRef.current = null;
      }
    };

    if (!hasPickup || !hasDropoff || !pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      lastComputedRouteKeyRef.current = '';
      clearRoutePolylines();
      return;
    }

    const origin = { lat: pickupLat, lng: pickupLng };
    const destination = { lat: dropoffLat, lng: dropoffLng };
    const routeKey = `${pickupLat.toFixed(4)}_${pickupLng.toFixed(4)}->${dropoffLat.toFixed(4)}_${dropoffLng.toFixed(4)}`;

    const applyPath = (path: google.maps.LatLngLiteral[]) => {
      if (!map) return;
      clearRoutePolylines();
      routeGlowRef.current = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: '#059669',
        strokeOpacity: 0.35,
        strokeWeight: 9,
        zIndex: 10,
        map,
      });
      routePolylineRef.current = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: '#10b981',
        strokeOpacity: 0.96,
        strokeWeight: 4.5,
        zIndex: 11,
        map,
      });
    };

    const cached = routePathCacheRef.current.get(routeKey);
    if (cached && cached.length >= 2) {
      applyPath(cached);
      return;
    }

    // Immediate straight geodesic preview while Routes API computes
    applyPath([origin, destination]);

    if (!routesLib || lastComputedRouteKeyRef.current === routeKey) {
      return;
    }
    lastComputedRouteKeyRef.current = routeKey;

    let cancelled = false;

    routesLib.Route.computeRoutes({
      origin,
      destination,
      travelMode: 'DRIVING',
      fields: ['path', 'viewport', 'distanceMeters', 'durationMillis'],
      internalUsageAttributionIds: [GOOGLE_MAPS_ATTRIBUTION_ID],
    })
      .then((res) => {
        if (cancelled) return;
        const primaryRoute = res.routes?.[0];
        if (primaryRoute?.path && primaryRoute.path.length >= 2) {
          const coords: google.maps.LatLngLiteral[] = primaryRoute.path.map((pt) => ({
            lat: pt.lat,
            lng: pt.lng,
          }));
          routePathCacheRef.current.set(routeKey, coords);
          applyPath(coords);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          checkAndDispatchGmpQuotaError(err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [map, routesLib, hasPickup, hasDropoff, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  // Cleanup route polylines on unmount
  useEffect(() => {
    return () => {
      routePolylineRef.current?.setMap(null);
      routeGlowRef.current?.setMap(null);
      guideLineRef.current?.setMap(null);
      walkLineRef.current?.setMap(null);
    };
  }, []);

  // Captain -> Target live guidance line (when ride is active)
  useEffect(() => {
    if (!map) return;

    if (guideLineRef.current) {
      guideLineRef.current.setMap(null);
      guideLineRef.current = null;
    }

    if (activeRideStatus === 'captain_accepted' && captainLat && captainLng && pickupLat && pickupLng) {
      guideLineRef.current = new google.maps.Polyline({
        path: [
          { lat: captainLat, lng: captainLng },
          { lat: pickupLat, lng: pickupLng },
        ],
        geodesic: true,
        strokeColor: '#10b981',
        strokeOpacity: 0,
        icons: [
          {
            icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.95, strokeColor: '#10b981', scale: 4 },
            offset: '0',
            repeat: '16px',
          },
        ],
        zIndex: 14,
        map,
      });
    } else if (activeRideStatus === 'trip_started' && captainLat && captainLng && dropoffLat && dropoffLng) {
      guideLineRef.current = new google.maps.Polyline({
        path: [
          { lat: captainLat, lng: captainLng },
          { lat: dropoffLat, lng: dropoffLng },
        ],
        geodesic: true,
        strokeColor: '#0284c7',
        strokeOpacity: 0,
        icons: [
          {
            icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.95, strokeColor: '#0284c7', scale: 4 },
            offset: '0',
            repeat: '16px',
          },
        ],
        zIndex: 14,
        map,
      });
    }
  }, [map, activeRideStatus, captainLat, captainLng, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  // Passenger standing GPS -> Pickup A walking guide line
  useEffect(() => {
    if (!map) return;

    if (walkLineRef.current) {
      walkLineRef.current.setMap(null);
      walkLineRef.current = null;
    }

    const isRideBooked = Boolean(activeRideStatus);
    if (!isRideBooked && hasPickup && passengerLat && passengerLng && pickupLat && pickupLng) {
      const distMeters = Math.round(
        calculateHaversineDistanceKm(passengerLat, passengerLng, pickupLat, pickupLng) * 1000
      );
      if (distMeters >= 12 && distMeters <= 1500) {
        walkLineRef.current = new google.maps.Polyline({
          path: [
            { lat: passengerLat, lng: passengerLng },
            { lat: pickupLat, lng: pickupLng },
          ],
          geodesic: true,
          strokeOpacity: 0,
          icons: [
            {
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.75, strokeColor: '#0f172a', scale: 3 },
              offset: '0',
              repeat: '12px',
            },
          ],
          zIndex: 9,
          map,
        });
      }
    }
  }, [map, activeRideStatus, hasPickup, passengerLat, passengerLng, pickupLat, pickupLng]);

  // Fit bounds when pickup/dropoff/active ride status changes
  useEffect(() => {
    if (!map) return;

    if (hasPickup && hasDropoff && pickupLat && pickupLng && dropoffLat && dropoffLng) {
      const boundsKey = `${pickupLat.toFixed(4)}_${pickupLng.toFixed(4)}_${dropoffLat.toFixed(4)}_${dropoffLng.toFixed(4)}_${activeRideStatus || ''}_${showLocationsABOnly ? '1' : '0'}`;
      if (lastFittedBoundsKeyRef.current !== boundsKey) {
        lastFittedBoundsKeyRef.current = boundsKey;
        const bounds = new google.maps.LatLngBounds();
        bounds.extend({ lat: pickupLat, lng: pickupLng });
        bounds.extend({ lat: dropoffLat, lng: dropoffLng });
        if (captainLat && captainLng) {
          bounds.extend({ lat: captainLat, lng: captainLng });
        }
        if (!activeRideStatus && passengerLat && passengerLng) {
          bounds.extend({ lat: passengerLat, lng: passengerLng });
        }
        map.fitBounds(bounds, {
          top: 72,
          left: 48,
          right: 48,
          bottom: bottomSheetPadding || 200,
        });
      }
    } else if (isFollowingPassenger && passengerLat && passengerLng) {
      map.panTo({ lat: passengerLat, lng: passengerLng });
    }
  }, [
    map,
    hasPickup,
    hasDropoff,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    captainLat,
    captainLng,
    passengerLat,
    passengerLng,
    activeRideStatus,
    showLocationsABOnly,
    bottomSheetPadding,
    isFollowingPassenger,
  ]);

  // Recenter or focus on demand
  useEffect(() => {
    if (!map || recenterSignal === 0) return;
    if (hasPickup && hasDropoff && pickupLat && pickupLng && dropoffLat && dropoffLng) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: pickupLat, lng: pickupLng });
      bounds.extend({ lat: dropoffLat, lng: dropoffLng });
      if (captainLat && captainLng) bounds.extend({ lat: captainLat, lng: captainLng });
      map.fitBounds(bounds, {
        top: 72,
        left: 48,
        right: 48,
        bottom: bottomSheetPadding || 200,
      });
    } else if (pickupLat && pickupLng) {
      map.panTo({ lat: pickupLat, lng: pickupLng });
      map.setZoom(15);
    } else if (passengerLat && passengerLng) {
      map.panTo({ lat: passengerLat, lng: passengerLng });
      map.setZoom(16);
    }
  }, [recenterSignal]);

  useEffect(() => {
    if (!map || !focusTarget) return;
    map.panTo({ lat: focusTarget.lat, lng: focusTarget.lng });
    if (focusTarget.zoom) {
      map.setZoom(focusTarget.zoom);
    }
  }, [map, focusTarget]);

  return null;
};

export const PassengerGoogleMap: React.FC<PassengerGoogleMapProps> = ({
  pickupLat,
  pickupLng,
  pickupAddress,
  dropoffLat,
  dropoffLng,
  dropoffAddress,
  pickupDistanceText,
  dropoffDistanceText,
  captainLat,
  captainLng,
  captainHeading = 0,
  captainAccuracy,
  captainName = 'Captain',
  passengerLat,
  passengerLng,
  passengerAccuracy,
  passengerName = 'Standing Here',
  showLocationsABOnly = false,
  bottomSheetPadding,
  onLocateMe,
  onSetPickupToPassengerLocation,
  interactive = true,
  onMapClick,
  className = 'w-full h-full',
  activeLayer,
  onLayerChange,
  showOverlayControls = true,
  nearbyCaptains = [],
  nearestCaptain = null,
  onSelectCaptain,
  activeRideStatus = null,
}) => {
  const apiKey = useMemo(() => getGoogleMapsApiKey(), []);
  const layerMeta = GOOGLE_MAP_LAYERS[activeLayer] || GOOGLE_MAP_LAYERS['google-street'];

  const [isFollowingPassenger, setIsFollowingPassenger] = useState(true);
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [focusTarget, setFocusTarget] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
    nonce: number;
  } | null>(null);
  const [selectedInfo, setSelectedInfo] = useState<
    | { type: 'pickup' }
    | { type: 'dropoff' }
    | { type: 'captain'; captain: AvailableCaptainItem }
    | { type: 'active-captain' }
    | null
  >(null);

  const initialCenter = useMemo(
    () => ({
      lat: passengerLat || pickupLat || DEFAULT_CENTER.lat,
      lng: passengerLng || pickupLng || DEFAULT_CENTER.lng,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const lastViewRef = useRef<{ center: google.maps.LatLngLiteral; zoom: number }>({
    center: initialCenter,
    zoom: 15,
  });

  // Fallback to MotorideMap (with all 4 Google/Carto layers) if API key is not configured
  if (!apiKey) {
    return (
      <MotorideMap
        passengerLat={passengerLat}
        passengerLng={passengerLng}
        passengerAccuracy={passengerAccuracy}
        passengerName={passengerName}
        showPassengerOnly={false}
        nearbyCaptains={nearbyCaptains}
        nearestCaptain={nearestCaptain}
        showLocationsABOnly={showLocationsABOnly}
        onLocateMe={onLocateMe}
        pickupLat={pickupLat}
        pickupLng={pickupLng}
        pickupAddress={pickupAddress}
        dropoffLat={dropoffLat}
        dropoffLng={dropoffLng}
        dropoffAddress={dropoffAddress}
        captainLat={captainLat}
        captainLng={captainLng}
        captainHeading={captainHeading}
        captainAccuracy={captainAccuracy}
        captainName={captainName}
        activeRideStatus={activeRideStatus}
        bottomSheetPadding={bottomSheetPadding}
        interactive={interactive}
        onSetPickupToPassengerLocation={onSetPickupToPassengerLocation}
        onMapClick={onMapClick}
        className={className}
        initialLayer={activeLayer}
        onLayerChange={onLayerChange}
        showOverlayControls={showOverlayControls}
        onSelectCaptain={onSelectCaptain}
      />
    );
  }

  const hasPickup = Boolean(pickupLat && pickupLng && pickupAddress && pickupAddress.trim() !== '');
  const hasDropoff = Boolean(dropoffLat && dropoffLng && dropoffAddress && dropoffAddress.trim() !== '');
  const isRideBooked = Boolean(activeRideStatus);
  const shouldShowPassengerStanding = Boolean(
    passengerLat && passengerLng && !showLocationsABOnly && !isRideBooked
  );

  const distToPickupMeters =
    passengerLat && passengerLng && hasPickup && pickupLat && pickupLng
      ? Math.round(calculateHaversineDistanceKm(passengerLat, passengerLng, pickupLat, pickupLng) * 1000)
      : null;

  const isPickupAtPassenger = Boolean(
    hasPickup && distToPickupMeters !== null && distToPickupMeters < 12
  );

  const handleNavigatorCenter = () => {
    setIsFollowingPassenger(true);
    const lat = passengerLat || pickupLat;
    const lng = passengerLng || pickupLng;
    if (lat && lng) {
      setFocusTarget({ lat, lng, zoom: 16, nonce: Date.now() });
    }
    onLocateMe?.();
  };

  const handleFocusNearestCaptain = () => {
    if (!nearestCaptain) return;
    setIsFollowingPassenger(false);
    setFocusTarget({
      lat: nearestCaptain.lat,
      lng: nearestCaptain.lng,
      zoom: 16,
      nonce: Date.now(),
    });
    setSelectedInfo({ type: 'captain', captain: nearestCaptain });
  };

  const handleRecenter = () => {
    setRecenterSignal((s) => s + 1);
  };

  return (
    <div
      className={`relative ${className} overflow-hidden transition-colors duration-300 ${
        layerMeta.colorScheme === 'DARK' ? 'bg-slate-950' : 'bg-slate-100'
      }`}
    >
      <APIProvider apiKey={apiKey} language="en" region="IN">
        <GoogleMap
          key={`gmp-${layerMeta.colorScheme}`}
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
          onDragstart={() => setIsFollowingPassenger(false)}
          onCameraChanged={(ev) => {
            lastViewRef.current = {
              center: ev.detail.center,
              zoom: ev.detail.zoom,
            };
          }}
          onClick={(ev) => {
            setSelectedInfo(null);
            if (interactive && onMapClick && ev.detail.latLng) {
              onMapClick(ev.detail.latLng.lat, ev.detail.latLng.lng);
            }
          }}
        >
          <PassengerMapRouteAndCameraController
            pickupLat={pickupLat}
            pickupLng={pickupLng}
            pickupAddress={pickupAddress}
            dropoffLat={dropoffLat}
            dropoffLng={dropoffLng}
            dropoffAddress={dropoffAddress}
            captainLat={captainLat}
            captainLng={captainLng}
            passengerLat={passengerLat}
            passengerLng={passengerLng}
            showLocationsABOnly={showLocationsABOnly}
            bottomSheetPadding={bottomSheetPadding}
            activeRideStatus={activeRideStatus}
            isFollowingPassenger={isFollowingPassenger}
            recenterSignal={recenterSignal}
            focusTarget={focusTarget}
          />

          {/* 1. Passenger Standing GPS Marker */}
          {shouldShowPassengerStanding && passengerLat && passengerLng && (
            <AdvancedMarker
              position={{ lat: passengerLat, lng: passengerLng }}
              zIndex={3000}
              onClick={() => {
                if (onSetPickupToPassengerLocation) {
                  onSetPickupToPassengerLocation(passengerLat, passengerLng);
                }
              }}
              title={
                isPickupAtPassenger
                  ? 'Pickup Location (A) is set here'
                  : 'One click to set as Pickup Location (A)'
              }
            >
              <div className="relative flex flex-col items-center select-none cursor-pointer group">
                <div
                  className={`px-2.5 py-0.5 mb-1 rounded-full text-[10px] font-extrabold whitespace-nowrap border shadow-lg flex items-center gap-1.5 ${
                    isPickupAtPassenger
                      ? 'bg-emerald-950 text-white border-emerald-400'
                      : 'bg-black text-white border-white'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  <span>
                    {isPickupAtPassenger
                      ? 'A • PICKUP (You)'
                      : hasPickup
                      ? 'You (Tap for A)'
                      : 'Tap to set Pickup'}
                  </span>
                </div>
                <div
                  className={`relative w-11 h-11 rounded-full bg-white border-[3px] flex items-center justify-center shadow-xl transition-transform group-hover:scale-105 ${
                    isPickupAtPassenger ? 'border-emerald-500' : 'border-black'
                  }`}
                >
                  <svg viewBox="0 0 200 200" width="26" height="26" className="text-black">
                    <circle cx="124" cy="72" r="39" fill="currentColor" />
                    <path
                      d="M 72,200 C 74,168 56,122 36,80 C 26,58 13,36 9,21 C 5,8 17,-1 29,4 C 38,9 47,25 58,52 C 70,82 86,112 106,124 C 114,117 128,114 142,118 C 162,124 180,152 196,200 Z"
                      fill="currentColor"
                    />
                  </svg>
                </div>
                <div
                  className={`w-2 h-2 rounded-full mt-0.5 shadow ${
                    isPickupAtPassenger ? 'bg-emerald-500' : 'bg-black'
                  }`}
                />
              </div>
            </AdvancedMarker>
          )}

          {/* 2. Pickup Location (A) Marker */}
          {hasPickup && pickupLat && pickupLng && (
            <AdvancedMarker
              position={{ lat: pickupLat, lng: pickupLng }}
              zIndex={2000}
              onClick={() => setSelectedInfo({ type: 'pickup' })}
              title={`Pickup Location (A): ${pickupAddress || ''}`}
            >
              <div className="flex flex-col items-center cursor-pointer select-none">
                <div className="px-2 py-0.5 mb-1 rounded-md bg-slate-950 text-emerald-400 font-black text-[11px] border border-emerald-500 shadow-lg whitespace-nowrap flex items-center gap-1">
                  <span>A • PICKUP</span>
                  {pickupDistanceText && (
                    <span className="bg-emerald-500 text-slate-950 px-1 rounded text-[10px]">
                      {pickupDistanceText}
                    </span>
                  )}
                </div>
                <div className="relative flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center font-black text-sm border-2 border-white shadow-lg">
                    A
                  </div>
                  <div className="w-2.5 h-2.5 bg-emerald-500 rotate-45 -bottom-1 absolute border-r-2 border-b-2 border-white" />
                </div>
              </div>
            </AdvancedMarker>
          )}

          {/* 3. Dropoff Location (B) Marker */}
          {hasDropoff && dropoffLat && dropoffLng && (
            <AdvancedMarker
              position={{ lat: dropoffLat, lng: dropoffLng }}
              zIndex={1500}
              onClick={() => setSelectedInfo({ type: 'dropoff' })}
              title={`Drop-off Location (B): ${dropoffAddress || ''}`}
            >
              <div className="flex flex-col items-center cursor-pointer select-none">
                <div className="px-2 py-0.5 mb-1 rounded-md bg-slate-950 text-rose-400 font-black text-[11px] border border-rose-500 shadow-lg whitespace-nowrap flex items-center gap-1">
                  <span>B • DROPOFF</span>
                  {dropoffDistanceText && (
                    <span className="bg-rose-500 text-white px-1 rounded text-[10px]">
                      {dropoffDistanceText}
                    </span>
                  )}
                </div>
                <div className="relative flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-rose-500 text-white flex items-center justify-center font-black text-sm border-2 border-white shadow-lg">
                    B
                  </div>
                  <div className="w-2.5 h-2.5 bg-rose-500 rotate-45 -bottom-1 absolute border-r-2 border-b-2 border-white" />
                </div>
              </div>
            </AdvancedMarker>
          )}

          {/* 4. Active Ride Assigned Captain Marker */}
          {captainLat && captainLng && (
            <AdvancedMarker
              position={{ lat: captainLat, lng: captainLng }}
              zIndex={1450}
              onClick={() => setSelectedInfo({ type: 'active-captain' })}
              title={`${captainName || 'Captain'} Live Location`}
            >
              <div className="flex flex-col items-center cursor-pointer select-none">
                <div
                  className={`px-2.5 py-1 mb-1.5 rounded-full bg-slate-950 text-white font-black text-[11px] border-2 shadow-xl whitespace-nowrap flex items-center gap-1.5 ${
                    activeRideStatus === 'trip_started' ? 'border-sky-400' : 'border-emerald-400'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      activeRideStatus === 'trip_started' ? 'bg-sky-400' : 'bg-emerald-400'
                    }`}
                  />
                  <span>
                    {activeRideStatus === 'captain_accepted'
                      ? 'Captain Arriving (A)'
                      : activeRideStatus === 'captain_arrived'
                      ? 'Captain Arrived at (A)'
                      : activeRideStatus === 'trip_started'
                      ? 'On Trip to (B)'
                      : captainName}
                  </span>
                </div>
                <div
                  className={`w-11 h-11 rounded-full bg-white border-[3px] flex items-center justify-center shadow-xl ${
                    activeRideStatus === 'trip_started' ? 'border-sky-400' : 'border-emerald-500'
                  }`}
                  style={{ transform: `rotate(${captainHeading}deg)` }}
                >
                  <svg viewBox="0 0 100 100" width="30" height="30">
                    <circle cx="50" cy="50" r="41" fill="#ffffff" stroke="#000000" strokeWidth="11" />
                    <path
                      d="M 50,18 L 76,74 L 50,60 L 24,74 Z"
                      fill="#000000"
                      stroke="#000000"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            </AdvancedMarker>
          )}

          {/* 5. Nearby Online Captains (pre-booking) */}
          {nearbyCaptains.map((cpt) => {
            if (
              captainLat &&
              captainLng &&
              Math.abs(cpt.lat - captainLat) < 0.0001 &&
              Math.abs(cpt.lng - captainLng) < 0.0001
            ) {
              return null;
            }
            const isNearest = Boolean(
              cpt.isNearest || (nearestCaptain && nearestCaptain.id === cpt.id)
            );
            const distText =
              cpt.distanceKm != null
                ? cpt.distanceKm < 1
                  ? `${Math.round(cpt.distanceKm * 1000)}m`
                  : `${cpt.distanceKm.toFixed(1)}km`
                : '';

            return (
              <AdvancedMarker
                key={cpt.id}
                position={{ lat: cpt.lat, lng: cpt.lng }}
                zIndex={isNearest ? 1480 : 1320}
                onClick={() => {
                  setSelectedInfo({ type: 'captain', captain: cpt });
                  onSelectCaptain?.(cpt);
                }}
                title={`${cpt.name}${distText ? ` • ${distText}` : ''}`}
              >
                <div className="flex flex-col items-center cursor-pointer select-none">
                  <div
                    className={`px-2 py-0.5 mb-1 rounded-full bg-black text-white text-[10px] font-extrabold border shadow-lg whitespace-nowrap flex items-center gap-1 ${
                      isNearest ? 'border-emerald-400' : 'border-sky-400'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isNearest ? 'bg-emerald-400' : 'bg-sky-400'
                      }`}
                    />
                    <span className={isNearest ? 'text-emerald-300' : 'text-slate-100'}>
                      {isNearest ? 'Nearest Captain' : cpt.name}
                    </span>
                    {distText && (
                      <span className="bg-white/15 px-1 rounded text-[9px] font-mono-num">
                        {distText}
                      </span>
                    )}
                  </div>
                  <div
                    className={`w-10 h-10 rounded-full bg-white border-[3px] flex items-center justify-center shadow-lg ${
                      isNearest ? 'border-emerald-500' : 'border-sky-400'
                    }`}
                    style={{ transform: `rotate(${cpt.heading || 0}deg)` }}
                  >
                    <svg viewBox="0 0 100 100" width="26" height="26">
                      <circle
                        cx="50"
                        cy="50"
                        r="41"
                        fill="#ffffff"
                        stroke="#000000"
                        strokeWidth="11"
                      />
                      <path
                        d="M 50,18 L 76,74 L 50,60 L 24,74 Z"
                        fill="#000000"
                        stroke="#000000"
                        strokeWidth="2"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
              </AdvancedMarker>
            );
          })}

          {/* Declarative InfoWindow Popups */}
          {selectedInfo?.type === 'pickup' && hasPickup && pickupLat && pickupLng && (
            <InfoWindow
              position={{ lat: pickupLat, lng: pickupLng }}
              onCloseClick={() => setSelectedInfo(null)}
            >
              <div className="p-1 text-slate-900 min-w-[170px] text-xs">
                <div className="font-black text-emerald-700">Pickup Location (A)</div>
                <div className="font-semibold text-slate-700 mt-1">{pickupAddress}</div>
                {distToPickupMeters !== null && (
                  <div className="text-[11px] text-slate-500 mt-1">
                    {distToPickupMeters}m from your GPS
                  </div>
                )}
              </div>
            </InfoWindow>
          )}

          {selectedInfo?.type === 'dropoff' && hasDropoff && dropoffLat && dropoffLng && (
            <InfoWindow
              position={{ lat: dropoffLat, lng: dropoffLng }}
              onCloseClick={() => setSelectedInfo(null)}
            >
              <div className="p-1 text-slate-900 min-w-[170px] text-xs">
                <div className="font-black text-rose-700">Drop-off Location (B)</div>
                <div className="font-semibold text-slate-700 mt-1">{dropoffAddress}</div>
              </div>
            </InfoWindow>
          )}

          {selectedInfo?.type === 'active-captain' && captainLat && captainLng && (
            <InfoWindow
              position={{ lat: captainLat, lng: captainLng }}
              onCloseClick={() => setSelectedInfo(null)}
            >
              <div className="p-1 text-slate-900 min-w-[175px] text-xs">
                <div className="font-black text-amber-700">{captainName}</div>
                <div className="font-semibold text-slate-700 mt-1">
                  {activeRideStatus === 'captain_accepted'
                    ? 'Arriving to Pickup (A)'
                    : activeRideStatus === 'trip_started'
                    ? 'On Trip to Drop-off (B)'
                    : 'Live Tracking Active'}
                </div>
                {captainAccuracy != null && (
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    GPS Accuracy: ±{Math.round(captainAccuracy)}m
                  </div>
                )}
              </div>
            </InfoWindow>
          )}

          {selectedInfo?.type === 'captain' && (
            <InfoWindow
              position={{ lat: selectedInfo.captain.lat, lng: selectedInfo.captain.lng }}
              onCloseClick={() => setSelectedInfo(null)}
            >
              <div className="p-1 text-slate-900 min-w-[180px] text-xs">
                <div className="font-black text-emerald-700">
                  {selectedInfo.captain.isNearest ? 'Nearest Available Captain' : 'Available Captain'}
                </div>
                <div className="font-bold text-slate-900 mt-0.5">{selectedInfo.captain.name}</div>
                <div className="text-[11px] text-slate-600 mt-0.5">
                  {selectedInfo.captain.vehicleModel || 'Motoride Bike'}
                  {selectedInfo.captain.vehiclePlate ? ` • ${selectedInfo.captain.vehiclePlate}` : ''}
                </div>
                <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-slate-200 text-[11px] font-bold">
                  <span className="text-amber-600">
                    ★ {(selectedInfo.captain.rating || 4.9).toFixed(1)}
                  </span>
                  <span>
                    {selectedInfo.captain.distanceKm != null
                      ? selectedInfo.captain.distanceKm < 1
                        ? `${Math.round(selectedInfo.captain.distanceKm * 1000)}m`
                        : `${selectedInfo.captain.distanceKm.toFixed(1)} km`
                      : 'Nearby'}
                    {selectedInfo.captain.etaMinutes
                      ? ` (~${selectedInfo.captain.etaMinutes} min)`
                      : ''}
                  </span>
                </div>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </APIProvider>

      {/* Map Overlay Controls */}
      {showOverlayControls && (
        <>
          {/* Top Left: Live Passenger GPS Status HUD & Nearest Captain (offset past Profile 2-lines button) */}
          {!showLocationsABOnly && (
            <div className="absolute top-3 left-16 sm:left-20 z-[400] flex flex-wrap items-center gap-2 max-w-[calc(100%-5rem)]">
              {passengerLat && passengerLng && (
                <button
                  type="button"
                  onClick={handleNavigatorCenter}
                  title="Passenger Live Location GPS - Click to Recenter on My Location"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-slate-950/90 text-white backdrop-blur-md border border-slate-700/90 shadow-xl text-xs font-semibold hover:border-blue-500/80 transition-all cursor-pointer active:scale-95 whitespace-nowrap shrink-0"
                >
                  <div className="relative flex items-center justify-center w-2.5 h-2.5">
                    <span className="absolute w-full h-full rounded-full bg-blue-400 animate-ping opacity-75" />
                    <span className="relative w-2 h-2 rounded-full bg-blue-500" />
                  </div>
                  <span className="text-slate-200">My Location</span>
                  <span className="text-emerald-400 font-mono-num font-bold text-[11px] bg-emerald-500/10 px-1.5 py-0.5 rounded-lg border border-emerald-500/30">
                    {passengerAccuracy ? `±${Math.round(passengerAccuracy)}m` : 'Live'}
                  </span>
                </button>
              )}

              {nearestCaptain && (
                <button
                  type="button"
                  onClick={handleFocusNearestCaptain}
                  title={`Nearest Captain: ${nearestCaptain.name}`}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-slate-950/95 text-white backdrop-blur-md border border-emerald-500/90 shadow-xl text-xs font-semibold hover:border-emerald-400 hover:bg-slate-900 transition-all cursor-pointer active:scale-95 whitespace-nowrap shrink-0"
                >
                  <div className="relative flex items-center justify-center w-2.5 h-2.5">
                    <span className="absolute w-full h-full rounded-full bg-emerald-400 animate-ping opacity-75" />
                    <span className="relative w-2 h-2 rounded-full bg-emerald-500" />
                  </div>
                  <span className="text-emerald-400 font-bold">Nearest Captain</span>
                  {nearestCaptain.distanceKm != null && (
                    <span className="text-emerald-300 font-mono-num font-bold text-[11px] bg-emerald-500/20 px-1.5 py-0.5 rounded-lg border border-emerald-500/30">
                      {nearestCaptain.distanceKm < 1
                        ? `${Math.round(nearestCaptain.distanceKm * 1000)}m`
                        : `${nearestCaptain.distanceKm.toFixed(1)} km`}
                      {nearestCaptain.etaMinutes ? ` (~${nearestCaptain.etaMinutes}m)` : ''}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Top Right: Google Maps Layering Switcher, Navigator & Recenter */}
          <div className="absolute top-3 right-3 z-[400] flex items-center gap-2 max-w-[calc(100%-1.5rem)] flex-wrap justify-end">
            <div className="flex items-center p-1 rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200/90 shadow-md">
              <button
                type="button"
                onClick={() => onLayerChange('google-street')}
                title="Google Streets / Roadmap (Default)"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  activeLayer === 'google-street'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Compass className="w-3.5 h-3.5 text-current" />
                <span className="hidden sm:inline">Google Streets</span>
                <span className="sm:hidden">Streets</span>
              </button>

              <button
                type="button"
                onClick={() => onLayerChange('google-satellite')}
                title="Google Satellite Imagery"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  activeLayer === 'google-satellite'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Satellite className="w-3.5 h-3.5 text-current" />
                <span className="hidden sm:inline">Google Satellite</span>
                <span className="sm:hidden">Satellite</span>
              </button>

              <button
                type="button"
                onClick={() => onLayerChange('google-terrain')}
                title="Google Terrain (Topographic Relief)"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  activeLayer === 'google-terrain'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Mountain className="w-3.5 h-3.5 text-current" />
                <span className="hidden sm:inline">Google Terrain</span>
                <span className="sm:hidden">Terrain</span>
              </button>

              <button
                type="button"
                onClick={() => onLayerChange('voyager-dark')}
                title="Voyager Dark Night Mode"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  activeLayer === 'voyager-dark'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Moon className="w-3.5 h-3.5 text-current" />
                <span className="hidden sm:inline">Voyager Dark</span>
                <span className="sm:hidden">Dark</span>
              </button>
            </div>

            {!showLocationsABOnly && (
              <button
                type="button"
                onClick={handleNavigatorCenter}
                title="Center Navigator on Passenger Real-Time Live Location"
                className={`flex items-center gap-1.5 px-3 py-2 rounded-2xl border shadow-md backdrop-blur-md transition-all active:scale-95 cursor-pointer text-xs font-bold whitespace-nowrap shrink-0 ${
                  isFollowingPassenger
                    ? 'bg-blue-600 text-white border-blue-500 ring-2 ring-blue-400/40 shadow-blue-500/20'
                    : 'bg-white/95 hover:bg-white text-slate-800 border-slate-200/90'
                }`}
              >
                <Navigation
                  className={`w-4 h-4 ${
                    isFollowingPassenger ? 'text-white fill-white' : 'text-blue-600'
                  }`}
                />
                <span className="hidden sm:inline">Navigator</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleRecenter}
              title="Center Map"
              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-white/95 hover:bg-white text-slate-800 border border-slate-200/90 shadow-md backdrop-blur-md transition-all active:scale-95 cursor-pointer text-xs font-bold whitespace-nowrap shrink-0"
            >
              <Crosshair className="w-4 h-4 text-emerald-600" />
              <span className="hidden md:inline">Recenter</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};
