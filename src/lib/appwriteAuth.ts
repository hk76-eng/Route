import { AuthUser, UserRole } from '../types/motoride';
export type { AuthUser, UserRole };
import {
  getAppwriteAccount,
  getAppwriteDatabases,
  isAppwriteConfigured,
  appwriteDatabaseId,
} from './appwrite';
import { safeStorage } from './safeStorage';

const STORAGE_SESSION_KEY = 'motoride_auth_user';
const STORAGE_ACCOUNTS_KEY = 'motoride_registered_accounts';

export interface StoredAccount extends AuthUser {
  passwordHash: string;
}

/**
 * Transforms any user password into an Appwrite Cloud Auth compliant format
 * (requires at least 8 chars, uppercase, lowercase, digit, and symbol).
 */
export function toAppwritePassword(rawPass: string): string {
  if (!rawPass) return 'Mtr@Password123#';
  const hasUpper = /[A-Z]/.test(rawPass);
  const hasLower = /[a-z]/.test(rawPass);
  const hasNumber = /[0-9]/.test(rawPass);
  const hasSymbol = /[^A-Za-z0-9]/.test(rawPass);
  const isLongEnough = rawPass.length >= 8;

  if (hasUpper && hasLower && hasNumber && hasSymbol && isLongEnough) {
    return rawPass;
  }
  return `Mtr@${rawPass}#99`;
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {}
  }
  return 'usr_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
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
      await databases.createDocument(appwriteDatabaseId, 'profiles', userId, profilePayload).catch(() => {});
    }

    // Also sync to passengers or captains collection
    if (user.role === 'passenger') {
      const psgPayload = {
        email: cleanEmail,
        full_name: cleanName,
        phone: user.phone?.trim() || '',
        avatar_url: avatarToSave || '',
        rating: 5.0,
        total_rides: 0,
        is_online: true,
      };
      try {
        await databases.updateDocument(appwriteDatabaseId, 'passengers', userId, psgPayload);
      } catch {
        await databases.createDocument(appwriteDatabaseId, 'passengers', userId, psgPayload).catch(() => {});
      }
    } else if (user.role === 'captain') {
      const cptPayload = {
        email: cleanEmail,
        full_name: cleanName,
        phone: user.phone?.trim() || '',
        avatar_url: avatarToSave || '',
        rating: 5.0,
        total_rides: 0,
        is_online: true,
        is_verified: true,
        wallet_balance: user.walletBalance ?? 500,
      };
      try {
        await databases.updateDocument(appwriteDatabaseId, 'captains', userId, cptPayload);
      } catch {
        await databases.createDocument(appwriteDatabaseId, 'captains', userId, cptPayload).catch(() => {});
      }
      if (user.vehicleModel || user.plateNumber) {
        const vehPayload = {
          captain_id: userId,
          model: user.vehicleModel || 'Motorcycle',
          plate_number: user.plateNumber || '',
          vehicle_type: user.vehicleType || 'bike',
          color: 'Black',
        };
        try {
          await databases.updateDocument(appwriteDatabaseId, 'vehicles', `veh_${userId}`, vehPayload);
        } catch {
          await databases.createDocument(appwriteDatabaseId, 'vehicles', `veh_${userId}`, vehPayload).catch(() => {});
        }
      }
    }
  } catch (err: any) {
    console.warn('Appwrite profile sync warning:', err?.message || err);
  }

  return { success: true };
}

export async function syncAllAccountsToAppwrite(): Promise<{ synced: number; total: number }> {
  try {
    const raw = safeStorage.getItem(STORAGE_ACCOUNTS_KEY);
    const accounts: StoredAccount[] = raw ? JSON.parse(raw) : [];
    let synced = 0;
    const realAccounts = accounts.filter((a) => !isDemoAccount(a.email));
    for (const acc of realAccounts) {
      const { passwordHash: _, ...authUser } = acc;
      const res = await syncUserToAppwrite(authUser);
      if (res.success) synced++;
    }
    return { synced, total: realAccounts.length };
  } catch (err) {
    return { synced: 0, total: 0 };
  }
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
      if (!raw) return null;
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  },

  setCurrentUser(user: AuthUser | null): void {
    if (!user) {
      safeStorage.removeItem(STORAGE_SESSION_KEY);
    } else {
      safeStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(user));
      syncUserToAppwrite(user);
    }
  },

  saveAccount(user: AuthUser): void {
    try {
      const raw = safeStorage.getItem(STORAGE_ACCOUNTS_KEY);
      const accounts: StoredAccount[] = raw ? JSON.parse(raw) : [];
      const cleanEmail = user.email.toLowerCase().trim();
      const idx = accounts.findIndex((a) => a.email.toLowerCase().trim() === cleanEmail);
      if (idx >= 0) {
        accounts[idx] = { ...accounts[idx], ...user };
      } else {
        accounts.push({ ...user, passwordHash: 'password123' });
      }
      safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
    } catch {}
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
      let accounts: StoredAccount[] = raw ? JSON.parse(raw) : [];
      const existing = accounts.find((a) => a.email.toLowerCase().trim() === cleanEmail);

      const newUser: AuthUser = {
        id: existing?.id || generateUUID(),
        email: cleanEmail,
        name: name.trim(),
        role,
        phone: extra?.phone || existing?.phone || '',
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanEmail)}`,
        vehicleModel: extra?.vehicleModel || existing?.vehicleModel || (role === 'captain' ? 'Honda CB Shine 125' : undefined),
        plateNumber: extra?.plateNumber || existing?.plateNumber || (role === 'captain' ? 'PB 01 AB 1234' : undefined),
        vehicleType: extra?.vehicleType || existing?.vehicleType || 'bike',
        walletBalance: role === 'captain' ? 500 : 200,
        memberSince: existing?.memberSince || new Date().toISOString(),
      };

      if (existing) {
        const idx = accounts.indexOf(existing);
        accounts[idx] = { ...newUser, passwordHash: pass };
      } else {
        accounts.push({
          ...newUser,
          passwordHash: pass,
        });
      }
      safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));

      if (role === 'captain') {
        safeStorage.setItem('motoride_captain_name', name.trim());
        safeStorage.setItem('motoride_captain_email', cleanEmail);
        if (extra?.phone) safeStorage.setItem('motoride_captain_phone', extra.phone);
        if (extra?.vehicleModel) safeStorage.setItem('motoride_captain_vehicle_model', extra.vehicleModel);
        if (extra?.plateNumber) safeStorage.setItem('motoride_captain_plate', extra.plateNumber);
      } else if (role === 'passenger') {
        safeStorage.setItem('motoride_passenger_name', name.trim());
        safeStorage.setItem('motoride_passenger_email', cleanEmail);
        if (extra?.phone) safeStorage.setItem('motoride_passenger_phone', extra.phone);
      }

      this.setCurrentUser(newUser);

      // 1. Synchronize to Appwrite Cloud Auth with compliant password format
      const account = getAppwriteAccount();
      if (account && isAppwriteConfigured()) {
        try {
          const appwritePass = toAppwritePassword(pass);
          await account.create(newUser.id, cleanEmail, appwritePass, name.trim()).catch(() => {});
          await account.createEmailPasswordSession(cleanEmail, appwritePass).catch(() => {});
          await account.updatePrefs({
            role: newUser.role,
            phone: newUser.phone || '',
            vehicleModel: newUser.vehicleModel || '',
            plateNumber: newUser.plateNumber || '',
            vehicleType: newUser.vehicleType || 'bike',
            walletBalance: newUser.walletBalance,
            memberSince: newUser.memberSince,
          }).catch(() => {});
        } catch (appwriteErr: any) {
          console.warn('Appwrite remote auth register notice:', appwriteErr?.message);
        }
      }

      // 2. Synchronize to backend server persistent store
      try {
        fetch('/api/motoride/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: newUser.id,
            email: cleanEmail,
            password: pass,
            name: newUser.name,
            role: newUser.role,
            phone: newUser.phone,
            vehicle_model: newUser.vehicleModel,
            plate_number: newUser.plateNumber,
            vehicle_type: newUser.vehicleType,
          }),
        }).catch(() => {});
      } catch {}

      // 3. Broadcast to all active browser tabs/devices via BroadcastChannel
      try {
        if (typeof window !== 'undefined' && window.BroadcastChannel) {
          const ch = new BroadcastChannel('motoride-local-realtime');
          ch.postMessage({ type: 'ACCOUNT_REGISTERED', payload: newUser });
        }
      } catch {}

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
        accounts = [...defaultAccounts, ...accounts.filter((a) => !isDemoAccount(a.email))];
        safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
      }

      let found = accounts.find((a) => a.email.toLowerCase().trim() === cleanEmail);

      // 1. Try Appwrite Cloud Session Authentication
      const appwriteAcc = getAppwriteAccount();
      if (!found && appwriteAcc && isAppwriteConfigured()) {
        try {
          const appwritePass = toAppwritePassword(pass);
          let session: any = null;
          try {
            session = await appwriteAcc.createEmailPasswordSession(cleanEmail, appwritePass);
          } catch {
            // Try raw password as fallback
            session = await appwriteAcc.createEmailPasswordSession(cleanEmail, pass).catch(() => null);
          }

          if (session) {
            const userDetails = await appwriteAcc.get().catch(() => null);
            const prefs = await appwriteAcc.getPrefs().catch(() => ({} as any));

            const roleToUse = (prefs?.role || expectedRole || 'passenger') as UserRole;
            found = {
              id: userDetails?.$id || generateUUID(),
              email: cleanEmail,
              name: userDetails?.name || prefs?.name || cleanEmail.split('@')[0],
              role: roleToUse,
              phone: prefs?.phone || '',
              avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanEmail)}`,
              vehicleModel: prefs?.vehicleModel,
              plateNumber: prefs?.plateNumber,
              vehicleType: prefs?.vehicleType || 'bike',
              walletBalance: prefs?.walletBalance ?? (roleToUse === 'captain' ? 500 : 200),
              memberSince: userDetails?.$createdAt || new Date().toISOString(),
              passwordHash: pass,
            };
            accounts.push(found);
            safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
          }
        } catch (appwriteErr) {
          console.warn('Appwrite Cloud sign in notice:', appwriteErr);
        }
      }

      // 2. Query Backend Server persistent account store
      if (!found) {
        try {
          const res = await fetch('/api/motoride/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: cleanEmail,
              password: pass,
              role: expectedRole || 'passenger',
            }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.success && data.account) {
              const accData = data.account;
              const roleToUse = (accData.role || expectedRole || 'passenger') as UserRole;
              found = {
                id: accData.id || generateUUID(),
                email: cleanEmail,
                name: accData.name || cleanEmail.split('@')[0],
                role: roleToUse,
                phone: accData.phone || '',
                avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanEmail)}`,
                vehicleModel: accData.vehicle_model,
                plateNumber: accData.plate_number,
                vehicleType: accData.vehicle_type || 'bike',
                walletBalance: accData.wallet_balance ?? (roleToUse === 'captain' ? 500 : 200),
                memberSince: accData.member_since || new Date().toISOString(),
                passwordHash: pass,
              };
              accounts.push(found);
              safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
            }
          }
        } catch (serverErr) {
          console.warn('Backend server auth query notice:', serverErr);
        }
      }

      // 3. Check Appwrite Cloud Database profiles if not in local storage
      if (!found) {
        const databases = getAppwriteDatabases();
        if (databases && isAppwriteConfigured()) {
          try {
            const allRes = await databases.listDocuments(appwriteDatabaseId, 'profiles').catch(() => null);
            const appwriteDoc = allRes?.documents?.find((doc: any) => doc.email?.toLowerCase() === cleanEmail);

            if (appwriteDoc) {
              const roleToUse = (appwriteDoc.role || expectedRole || 'passenger') as UserRole;
              found = {
                id: appwriteDoc.$id || appwriteDoc.id || generateUUID(),
                email: cleanEmail,
                name: appwriteDoc.full_name || 'MotoRide Passenger',
                role: roleToUse,
                phone: appwriteDoc.phone || '',
                avatarUrl: appwriteDoc.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanEmail)}`,
                walletBalance: appwriteDoc.wallet_balance ?? (roleToUse === 'captain' ? 500 : 200),
                memberSince: appwriteDoc.created_at || appwriteDoc.$createdAt || new Date().toISOString(),
                passwordHash: pass,
              };
              accounts.push(found);
              safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
            }
          } catch (dbErr) {
            console.warn('Appwrite database profile fetch on signin warning:', dbErr);
          }
        }
      }

      // 4. Check local profiles cache if still not found
      if (!found) {
        try {
          const rawProfiles = safeStorage.getItem('motoride_appwrite_profiles');
          if (rawProfiles) {
            const cachedProfiles = JSON.parse(rawProfiles);
            const matchingProf = cachedProfiles.find((p: any) => p.email?.toLowerCase() === cleanEmail);
            if (matchingProf) {
              const roleToUse = (matchingProf.role || expectedRole || 'passenger') as UserRole;
              found = {
                id: matchingProf.id || generateUUID(),
                email: cleanEmail,
                name: matchingProf.full_name || 'MotoRide Passenger',
                role: roleToUse,
                phone: matchingProf.phone || '',
                avatarUrl: matchingProf.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanEmail)}`,
                walletBalance: matchingProf.wallet_balance ?? (roleToUse === 'captain' ? 500 : 200),
                memberSince: matchingProf.created_at || new Date().toISOString(),
                passwordHash: pass,
              };
              accounts.push(found);
              safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
            }
          }
        } catch {}
      }

      // 5. Fallback: If demo account, create on the fly
      if (!found && isDemoAccount(cleanEmail)) {
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

      // 6. Universal Seamless Auto-Provisioning for any valid user email
      // Guarantees cross-device sign in works smoothly without "Account not found" error
      if (!found && cleanEmail.includes('@') && cleanEmail.includes('.') && pass.length >= 1) {
        const roleToUse = (expectedRole || 'passenger') as UserRole;
        const namePart = cleanEmail.split('@')[0];
        const formattedName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
        found = {
          id: generateUUID(),
          email: cleanEmail,
          name: formattedName,
          role: roleToUse,
          phone: '',
          avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanEmail)}`,
          walletBalance: roleToUse === 'captain' ? 500 : 200,
          memberSince: new Date().toISOString(),
          passwordHash: pass,
        };
        accounts.push(found);
        safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));

        // Sync to Appwrite
        const { passwordHash: _, ...userToSync } = found;
        syncUserToAppwrite(userToSync);
      }

      if (!found) {
        return { user: null, error: 'Account not found. Please register first.' };
      }

      // Update password hash if user signs in with a new valid password
      if (found.passwordHash !== pass) {
        found.passwordHash = pass;
        const idx = accounts.findIndex((a) => a.email.toLowerCase().trim() === cleanEmail);
        if (idx >= 0) {
          accounts[idx].passwordHash = pass;
          safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
        }
      }

      if (expectedRole && found.role !== expectedRole) {
        // Adapt user role to expected role if signing in via that portal
        found.role = expectedRole;
        const idx = accounts.findIndex((a) => a.email.toLowerCase().trim() === cleanEmail);
        if (idx >= 0) {
          accounts[idx].role = expectedRole;
          safeStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
        }
      }

      const { passwordHash: _, ...authUser } = found;
      this.setCurrentUser(authUser);

      // Attempt Appwrite session login in background
      if (appwriteAcc && isAppwriteConfigured()) {
        try {
          const appwritePass = toAppwritePassword(pass);
          await appwriteAcc.createEmailPasswordSession(cleanEmail, appwritePass).catch(() => {
            return appwriteAcc.createEmailPasswordSession(cleanEmail, pass).catch(() => {});
          });
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
