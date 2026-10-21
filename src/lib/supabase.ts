export * from './appwrite';
import { isAppwriteConfigured } from './appwrite';
export const isSupabaseConfigured = isAppwriteConfigured;
export const getSupabase = () => null;
export const SUPABASE_CONFIG_STATUS = { isReady: false, urlPreview: 'Appwrite Active' };
export const SUPABASE_SQL_SCHEMA = `-- Appwrite Database Schema Setup --`;
