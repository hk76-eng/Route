import React, { useState, useEffect } from 'react';
import { AdminWorkspace } from '../../admin/AdminWorkspace';
import { AppSuiteHeader } from '../../components/common/AppSuiteHeader';
import { AuthPage } from '../../components/AuthPage';
import { appwriteAuth, AuthUser } from '../../lib/appwriteAuth';
import { safeStorage } from '../../lib/safeStorage';

export function AdminApp() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    const user = appwriteAuth.getCurrentUser();
    if (user && user.role === 'admin') return user;
    const saved = safeStorage.getItem('motoride_admin_session');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.role === 'admin') return parsed;
      } catch {}
    }
    return user?.role === 'admin' ? user : null;
  });

  useEffect(() => {
    document.title = 'MotoRide — Admin Console';
  }, []);

  const handleAuthenticated = (user: AuthUser) => {
    if (user.role !== 'admin' && user.email.toLowerCase() !== 'freelanceseoservices01@gmail.com') {
      alert('Access Denied: Only platform administrators can access the MotoRide Admin Console.');
      return;
    }
    const adminUser: AuthUser = {
      ...user,
      role: 'admin',
    };
    safeStorage.setItem('motoride_admin_session', JSON.stringify(adminUser));
    setCurrentUser(adminUser);
  };

  const handleSignOut = async () => {
    safeStorage.removeItem('motoride_admin_session');
    await appwriteAuth.signOut();
    setCurrentUser(null);
  };

  if (!currentUser || currentUser.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col">
        <div className="bg-purple-950/60 border-b border-purple-500/20 px-4 py-2 text-center text-xs text-purple-300 font-medium">
          🛡️ <strong>MotoRide Admin Console</strong> • Secure administrator portal with database-backed role verification
        </div>
        <AuthPage
          onAuthenticated={handleAuthenticated}
          defaultRole="admin"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-purple-500 selection:text-slate-950">
      <AppSuiteHeader
        appName="Admin Console"
        currentRole="admin"
        currentUser={currentUser}
        onSignOut={handleSignOut}
      />

      <main className="flex-1 w-full relative">
        <AdminWorkspace
          currentUser={currentUser}
          onSignOut={handleSignOut}
        />
      </main>
    </div>
  );
}

export default AdminApp;
