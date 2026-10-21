import { getAppwriteAccount, getAppwriteDatabases, appwriteDatabaseId, isAppwriteConfigured } from './appwrite';
import { safeStorage } from './safeStorage';
import { UserRole } from '../types/motoride';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone?: string;
  avatarUrl?: string;
  vehicleModel?: string;
  plateNumber?: string;
  vehicleType?: 'bike' | 'auto' | 'car' | 'courier';
  walletBalance?: number;
  memberSince?: string;
}

export interface StoredAccount extends AuthUser {
  passwordHash: string;
}

const STORAGE_SESSION_KEY = 'motoride_auth_session_user';
const STORAGE_ACCOUNTS_KEY = 'motoride_registered_accounts';

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Ensures user is synced to Appwrite databases / profiles
 */
export async function syncUserToAppwrite(user: AuthUser): Promise<{ success: boolean; error?: string }> {
  const cleanEmail = user.email.toLowerCase().trim();
  const cleanName = (user.name || '').trim() || 'MotoRide User';
  const userId = user.id || generateUUID();
  const avatarToSave = user.avatarUrl || safeStorage.getItem(`motoride_${user.role}_avatar`) || null;

  try {
    const rawCache = safeStorage.getItem('motoride_appwrite_profiles');
    const profilesCache = rawCache ? JSON.parse(rawCache) : [];
    const idx = profilesCache.findIndex((p: any) => p.email?.toLowerCase() === cleanEmail || p.id === userId);
    const profileObj = {
      id: userId,
      email: cleanEmail,
      full_name: cleanName,
      phone: user.phone?.trim() || '',
      role: user.role,
      avatar_url: avatarToSave,
      wallet_balance: user.walletBalance ?? (user.role === 'captain' ? 500 : 200),
      is_active: true,
      created_at: user.memberSince || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (idx >= 0) profilesCache[idx] = profileObj;
    else profilesCache.push(profileObj);
    safeStorage.setItem('motoride_appwrite_profiles', JSON.stringify(profilesCache));
  } catch {}

  const databases = getAppwriteDatabases();
  if (!databases || !isAppwriteConfigured()) {
    return { success: true, error: 'Appwrite not configured' };
  }

  try {
    const profilePayload = {
      email: cleanEmail,
      full_name: cleanName,
      phone: user.phone?.trim() || '',
      role: user.role,
      avatar_url: avatarToSave || '',
      wallet_balance: user.walletBalance ?? (user.role === 'captain' ? 500 : 200),
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    try {
      await databases.updateDocument(appwriteDatabaseId, 'profiles', userId, profilePayload);
    } catch {
      await databases.createDocument(appwriteDatabaseId, 'profiles', userId, profilePayload);
    }
  } catch (err: any) {
    console.warn('Appwrite profile sync warning:', err?.message || err);
  }

  return { success: true };
}

export function isDemoAccount(email: string): boolean {
  const clean = email.toLowerCase().trim();
  return (
    clean === 'passenger@motoride.app' ||
    clean === 'captain@motoride.app' ||
    clean === 'admin@motoride.app'
  );
}

export function isDemoRide(rideId: string): boolean {
  return typeof rideId === 'string' && rideId.startsWith('demo-');
}

export const appwriteAuth = {
  getCurrentUser(): AuthUser | null {
    try {
      const raw = safeStorage.getItem(STORAGE_SESSION_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {}
    return null;
  },

  setCurrentUser(user: AuthUser | null): void {
    if (!user) {
      safeStorage.removeItem(STORAGE_SESSION_KEY);
    } else {
      safeStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(user));
      syncUserToAppwrite(user);
    }
  },

  updatePasswordLocally(email: string, newPass: string): void {
    try {
      const raw = safeStorage.getItem(STORAGE_ACCOUNTS_KEY);
      const accounts: StoredAccount[] = raw ? JSON.parse(raw) : [];
      const cleanEmail = email.toLowerCase().trim();
      const idx = accounts.findIndex((a) => a.email.toLowerCase().trim() === cleanEmail);
      if (idx >= 0) {
        accounts[idx].passwordHash = newPass;
        safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
      }
    } catch {}
  },

  async signUp(
    email: string,
    pass: string,
    name: string,
    role: UserRole,
    extra?: { phone?: string; vehicleModel?: string; plateNumber?: string; vehicleType?: 'bike' | 'auto' | 'car' | 'courier' }
  ): Promise<{ user: AuthUser | null; error?: string }> {
    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail || !pass || !name) {
      return { user: null, error: 'Please provide email, password, and name.' };
    }

    try {
      const raw = safeStorage.getItem(STORAGE_ACCOUNTS_KEY);
      const accounts: StoredAccount[] = raw ? JSON.parse(raw) : [];
      const existing = accounts.find((a) => a.email.toLowerCase().trim() === cleanEmail);
      if (existing) {
        return { user: null, error: 'An account with this email already exists. Please sign in.' };
      }

      const newUser: AuthUser = {
        id: generateUUID(),
        email: cleanEmail,
        name: name.trim(),
        role,
        phone: extra?.phone || '',
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanEmail)}`,
        vehicleModel: extra?.vehicleModel,
        plateNumber: extra?.plateNumber,
        vehicleType: extra?.vehicleType || 'bike',
        walletBalance: role === 'captain' ? 500 : 200,
        memberSince: new Date().toISOString(),
      };

      accounts.push({
        ...newUser,
        passwordHash: pass,
      });
      safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));

      if (role === 'captain') {
        safeStorage.setItem('motoride_captain_name', name.trim());
        safeStorage.setItem('motoride_captain_email', cleanEmail);
        if (extra?.phone) safeStorage.setItem('motoride_captain_phone', extra.phone);
        if (extra?.vehicleModel) safeStorage.setItem('motoride_captain_vehicle_model', extra.vehicleModel);
        if (extra?.plateNumber) safeStorage.setItem('motoride_captain_plate', extra.plateNumber);
      }

      this.setCurrentUser(newUser);

      // Attempt Appwrite Auth account registration
      const account = getAppwriteAccount();
      if (account && isAppwriteConfigured()) {
        try {
          await account.create(newUser.id, cleanEmail, pass, name.trim());
          await account.createEmailPasswordSession(cleanEmail, pass);
        } catch (appwriteErr: any) {
          console.warn('Appwrite remote auth register notice:', appwriteErr?.message);
        }
      }

      return { user: newUser };
    } catch (err: any) {
      return { user: null, error: err?.message || 'Registration failed.' };
    }
  },

  async signIn(email: string, pass: string, expectedRole?: UserRole): Promise<{ user: AuthUser | null; error?: string }> {
    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail || !pass) {
      return { user: null, error: 'Please enter email and password.' };
    }

    try {
      const raw = safeStorage.getItem(STORAGE_ACCOUNTS_KEY);
      let accounts: StoredAccount[] = raw ? JSON.parse(raw) : [];

      // Ensure default test accounts exist
      if (accounts.length === 0 || !accounts.some((a) => isDemoAccount(a.email))) {
        const defaultAccounts: StoredAccount[] = [
          {
            id: 'demo-passenger-01',
            email: 'passenger@motoride.app',
            name: 'Demo Passenger',
            role: 'passenger',
            phone: '+919876543210',
            avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
            walletBalance: 350,
            memberSince: new Date().toISOString(),
            passwordHash: 'password123',
          },
          {
            id: 'demo-captain-01',
            email: 'captain@motoride.app',
            name: 'Alex Rider (Captain)',
            role: 'captain',
            phone: '+919876543211',
            avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
            vehicleModel: 'Honda CB Shine 125',
            plateNumber: 'PB 01 AB 1234',
            vehicleType: 'bike',
            walletBalance: 1200,
            memberSince: new Date().toISOString(),
            passwordHash: 'password123',
          },
          {
            id: 'demo-admin-01',
            email: 'admin@motoride.app',
            name: 'System Administrator',
            role: 'admin',
            phone: '+919876543212',
            avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150',
            walletBalance: 5000,
            memberSince: new Date().toISOString(),
            passwordHash: 'password123',
          },
        ];
        accounts = [...defaultAccounts, ...accounts];
        safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
      }

      let found = accounts.find((a) => a.email.toLowerCase().trim() === cleanEmail);

      if (!found && isDemoAccount(cleanEmail)) {
        // Fallback create demo account on the fly if missing
        const role = cleanEmail.includes('captain') ? 'captain' : cleanEmail.includes('admin') ? 'admin' : 'passenger';
        found = {
          id: `demo-${role}-01`,
          email: cleanEmail,
          name: role === 'admin' ? 'System Administrator' : role === 'captain' ? 'Alex Rider (Captain)' : 'Demo Passenger',
          role: role as UserRole,
          phone: '+919876543210',
          avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
          vehicleModel: role === 'captain' ? 'Yamaha FZ v3' : undefined,
          plateNumber: role === 'captain' ? 'PB 10 XY 9999' : undefined,
          walletBalance: role === 'captain' ? 1000 : 300,
          memberSince: new Date().toISOString(),
          passwordHash: pass,
        };
        accounts.push(found);
        safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
      }

      if (!found) {
        return { user: null, error: 'Account not found. Please register first.' };
      }

      if (found.passwordHash !== pass) {
        return { user: null, error: 'Incorrect password.' };
      }

      if (expectedRole && found.role !== expectedRole) {
        return {
          user: null,
          error: `This account is registered as a ${found.role}, but you are trying to sign in via the ${expectedRole} portal. Please use the correct application link.`,
        };
      }

      const { passwordHash: _, ...authUser } = found;
      this.setCurrentUser(authUser);

      // Attempt Appwrite session login
      const account = getAppwriteAccount();
      if (account && isAppwriteConfigured()) {
        try {
          await account.createEmailPasswordSession(cleanEmail, pass);
        } catch {}
      }

      return { user: authUser };
    } catch (err: any) {
      return { user: null, error: err?.message || 'Sign in failed.' };
    }
  },

  async signOut(): Promise<void> {
    this.setCurrentUser(null);
    const account = getAppwriteAccount();
    if (account && isAppwriteConfigured()) {
      try {
        await account.deleteSession('current');
      } catch {}
    }
  },
};

export async function syncAllAccountsToAppwrite(): Promise<{ synced: number; errors: number }> {
  try {
    const raw = safeStorage.getItem(STORAGE_ACCOUNTS_KEY);
    const accounts: StoredAccount[] = raw ? JSON.parse(raw) : [];
    let synced = 0;
    let errors = 0;
    for (const acc of accounts) {
      const { passwordHash, ...user } = acc;
      const res = await syncUserToAppwrite(user);
      if (res.success) synced++;
      else errors++;
    }
    return { synced, errors };
  } catch {
    return { synced: 0, errors: 1 };
  }
}
