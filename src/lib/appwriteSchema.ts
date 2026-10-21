/**
 * MotoRide Appwrite Database Collections & Schema Blueprint
 * Database ID: motoride_db
 * Project ID: 6ad0ec20000c3632117b
 * Endpoint: https://fra.cloud.appwrite.io/v1
 * Storage Bucket: route_media (6ad8dec90028274c8e3c)
 */

export interface AppwriteCollectionBlueprint {
  id: string;
  name: string;
  attributes: {
    key: string;
    type: 'string' | 'integer' | 'float' | 'boolean' | 'datetime';
    size?: number;
    required?: boolean;
    defaultValue?: any;
    array?: boolean;
  }[];
  indexes?: {
    key: string;
    type: 'key' | 'unique' | 'fulltext';
    attributes: string[];
  }[];
}

export const APPWRITE_COLLECTIONS: AppwriteCollectionBlueprint[] = [
  {
    id: 'profiles',
    name: 'User Profiles',
    attributes: [
      { key: 'email', type: 'string', size: 255, required: true },
      { key: 'full_name', type: 'string', size: 255, required: true },
      { key: 'phone', type: 'string', size: 50, required: false },
      { key: 'role', type: 'string', size: 50, required: true },
      { key: 'avatar_url', type: 'string', size: 1024, required: false },
      { key: 'wallet_balance', type: 'float', required: false, defaultValue: 0 },
      { key: 'is_active', type: 'boolean', required: false, defaultValue: true },
      { key: 'updated_at', type: 'datetime', required: false },
    ],
  },
  {
    id: 'passengers',
    name: 'Passengers',
    attributes: [
      { key: 'email', type: 'string', size: 255, required: true },
      { key: 'full_name', type: 'string', size: 255, required: true },
      { key: 'phone', type: 'string', size: 50, required: false },
      { key: 'avatar_url', type: 'string', size: 1024, required: false },
      { key: 'rating', type: 'float', required: false, defaultValue: 5.0 },
      { key: 'total_rides', type: 'integer', required: false, defaultValue: 0 },
      { key: 'live_lat', type: 'float', required: false },
      { key: 'live_lng', type: 'float', required: false },
      { key: 'live_address', type: 'string', size: 500, required: false },
      { key: 'is_online', type: 'boolean', required: false, defaultValue: true },
    ],
  },
  {
    id: 'captains',
    name: 'Captains',
    attributes: [
      { key: 'email', type: 'string', size: 255, required: true },
      { key: 'full_name', type: 'string', size: 255, required: true },
      { key: 'phone', type: 'string', size: 50, required: false },
      { key: 'avatar_url', type: 'string', size: 1024, required: false },
      { key: 'rating', type: 'float', required: false, defaultValue: 5.0 },
      { key: 'total_rides', type: 'integer', required: false, defaultValue: 0 },
      { key: 'is_online', type: 'boolean', required: false, defaultValue: false },
      { key: 'live_lat', type: 'float', required: false },
      { key: 'live_lng', type: 'float', required: false },
      { key: 'live_address', type: 'string', size: 500, required: false },
      { key: 'is_verified', type: 'boolean', required: false, defaultValue: true },
      { key: 'wallet_balance', type: 'float', required: false, defaultValue: 500 },
    ],
  },
  {
    id: 'vehicles',
    name: 'Vehicles',
    attributes: [
      { key: 'captain_id', type: 'string', size: 255, required: true },
      { key: 'model', type: 'string', size: 255, required: true },
      { key: 'plate_number', type: 'string', size: 100, required: true },
      { key: 'vehicle_type', type: 'string', size: 50, required: true },
      { key: 'color', type: 'string', size: 50, required: false },
    ],
  },
  {
    id: 'rides',
    name: 'Rides and Couriers',
    attributes: [
      { key: 'passenger_id', type: 'string', size: 255, required: true },
      { key: 'passenger_name', type: 'string', size: 255, required: true },
      { key: 'passenger_phone', type: 'string', size: 50, required: false },
      { key: 'captain_id', type: 'string', size: 255, required: false },
      { key: 'captain_name', type: 'string', size: 255, required: false },
      { key: 'captain_phone', type: 'string', size: 50, required: false },
      { key: 'pickup_address', type: 'string', size: 500, required: true },
      { key: 'drop_address', type: 'string', size: 500, required: true },
      { key: 'pickup_lat', type: 'float', required: true },
      { key: 'pickup_lng', type: 'float', required: true },
      { key: 'drop_lat', type: 'float', required: true },
      { key: 'drop_lng', type: 'float', required: true },
      { key: 'distance_km', type: 'float', required: true },
      { key: 'fare_amount', type: 'float', required: true },
      { key: 'status', type: 'string', size: 50, required: true },
      { key: 'type', type: 'string', size: 50, required: true },
      { key: 'pin', type: 'string', size: 10, required: false },
      { key: 'commission_rate', type: 'float', required: false, defaultValue: 0.10 },
      { key: 'commission_amount', type: 'float', required: false },
    ],
  },
  {
    id: 'wallets',
    name: 'Wallets',
    attributes: [
      { key: 'user_id', type: 'string', size: 255, required: true },
      { key: 'role', type: 'string', size: 50, required: true },
      { key: 'balance', type: 'float', required: true, defaultValue: 0 },
      { key: 'currency', type: 'string', size: 10, required: false, defaultValue: 'INR' },
      { key: 'updated_at', type: 'datetime', required: false },
    ],
  },
];

export const APPWRITE_SCHEMA_SPEC_JSON = JSON.stringify(
  {
    projectId: '6ad0ec20000c3632117b',
    endpoint: 'https://fra.cloud.appwrite.io/v1',
    databaseId: 'motoride_db',
    name: 'MotoRide Production Database',
    storage: {
      bucketId: '6ad8dec90028274c8e3c',
      name: 'route_media',
      maxFileSize: '50MB',
      allowedFileExtensions: ['jpg', 'png', 'webp', 'jpeg', 'svg', 'mp4'],
      permissions: ['read("any")', 'create("any")'],
    },
    collections: APPWRITE_COLLECTIONS,
  },
  null,
  2
);
