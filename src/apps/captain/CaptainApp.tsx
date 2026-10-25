import React, { useState, useEffect } from 'react';
import { CaptainWorkspace } from '../../captain/CaptainWorkspace';
import { AppSuiteHeader } from '../../components/common/AppSuiteHeader';
import { WalletModal } from '../../components/common/WalletModal';
import { NotificationsModal } from '../../components/common/NotificationsModal';
import { AuthPage } from '../../components/AuthPage';
import { appwriteAuth, AuthUser } from '../../lib/appwriteAuth';
import { safeStorage } from '../../lib/safeStorage';
import { motorideApi } from '../../services/motorideApi';

export function CaptainApp() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    const user = appwriteAuth.getCurrentUser();
    if (user && user.role === 'captain') return user;
    const saved = safeStorage.getItem('motoride_captain_session');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return user?.role === 'captain' ? user : null;
  });

  const [walletBalance, setWalletBalance] = useState<number>(() => {
    return currentUser?.walletBalance || 500;
  });
  const [isCaptainOnline, setIsCaptainOnline] = useState<boolean>(true);
  const [isWalletOpen, setIsWalletOpen] = useState<boolean>(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState<boolean>(false);

  useEffect(() => {
    document.title = 'Route — Captain App';
  }, []);

  const handleAuthenticated = (user: AuthUser) => {
    const captainUser: AuthUser = {
      ...user,
      role: 'captain',
    };
    safeStorage.setItem('motoride_captain_session', JSON.stringify(captainUser));
    setCurrentUser(captainUser);
    if (captainUser.walletBalance !== undefined) {
      setWalletBalance(captainUser.walletBalance);
    }
  };

  const handleSignOut = async () => {
    safeStorage.removeItem('motoride_captain_session');
    await appwriteAuth.signOut();
    setCurrentUser(null);
  };

  const handleToggleOnline = async () => {
    const nextState = !isCaptainOnline;
    setIsCaptainOnline(nextState);
    if (currentUser?.id) {
      try {
        await motorideApi.toggleCaptainOnline(currentUser.id, nextState);
      } catch (err) {
        console.warn('Failed to toggle captain online:', err);
      }
    }
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col">
        <div className="bg-amber-950/60 border-b border-amber-500/20 px-4 py-2 text-center text-xs text-amber-300 font-medium">
          🏍️ <strong>Route Captain Application</strong> • Sign in or register as a Captain to receive live rides & couriers
        </div>
        <AuthPage
          onAuthenticated={handleAuthenticated}
          defaultRole="captain"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-amber-500 selection:text-slate-950">
      <AppSuiteHeader
        appName="Captain Application"
        currentRole="captain"
        currentUser={currentUser}
        onSignOut={handleSignOut}
        onOpenWallet={() => setIsWalletOpen(true)}
        isCaptainOnline={isCaptainOnline}
        onToggleCaptainOnline={handleToggleOnline}
      />

      <main className="flex-1 w-full relative">
        <CaptainWorkspace
          captainId={currentUser.id}
          captainName={currentUser.name}
          currentUser={currentUser}
          onOpenWallet={() => setIsWalletOpen(true)}
          onSignOut={handleSignOut}
          isOnline={isCaptainOnline}
          onToggleOnline={handleToggleOnline}
        />
      </main>

      <WalletModal
        isOpen={isWalletOpen}
        onClose={() => setIsWalletOpen(false)}
        userId={currentUser.id}
        userRole="captain"
        currentBalance={walletBalance}
        onBalanceUpdated={(newBal) => setWalletBalance(newBal)}
      />

      <NotificationsModal
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
      />
    </div>
  );
}
