export * from './appwriteAuth';
import { appwriteAuth, syncUserToAppwrite, syncAllAccountsToAppwrite } from './appwriteAuth';

export const supabaseAuth = {
  ...appwriteAuth,
  saveAccount: (user: any) => {
    try {
      const raw = localStorage.getItem('motoride_registered_accounts');
      const accounts = raw ? JSON.parse(raw) : [];
      const idx = accounts.findIndex((a: any) => a.email === user.email);
      if (idx >= 0) accounts[idx] = user;
      else accounts.push(user);
      localStorage.setItem('motoride_registered_accounts', JSON.stringify(accounts));
    } catch {}
  },
  getRegisteredAccounts: () => {
    try {
      const raw = localStorage.getItem('motoride_registered_accounts');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
};

export const syncUserToSupabase = syncUserToAppwrite;
export const syncAllAccountsToSupabase = syncAllAccountsToAppwrite;
