import React, { useState, useEffect } from 'react';
import { PassengerWorkspace } from '../../passenger/PassengerWorkspace';
import { AppSuiteHeader } from '../../components/common/AppSuiteHeader';
import { WalletModal } from '../../components/common/WalletModal';
import { NotificationsModal } from '../../components/common/NotificationsModal';
import { AuthPage } from '../../components/AuthPage';
import { appwriteAuth, AuthUser } from '../../lib/appwriteAuth';
import { safeStorage } from '../../lib/safeStorage';

export function PassengerApp() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    const user = appwriteAuth.getCurrentUser();
    if (user && user.role === 'passenger') return user;
    const saved = safeStorage.getItem('motoride_passenger_session');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return user?.role === 'passenger' ? user : null;
  });

  const [walletBalance, setWalletBalance] = useState<number>(() => {
    return currentUser?.walletBalance || 200;
  });
  const [isWalletOpen, setIsWalletOpen] = useState<boolean>(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState<boolean>(false);

  useEffect(() => {
    document.title = 'Route — Passenger App';
  }, []);

  const handleAuthenticated = (user: AuthUser) => {
    const passengerUser: AuthUser = {
      ...user,
      role: 'passenger',
    };
    safeStorage.setItem('motoride_passenger_session', JSON.stringify(passengerUser));
    setCurrentUser(passengerUser);
    if (passengerUser.walletBalance !== undefined) {
      setWalletBalance(passengerUser.walletBalance);
    }
  };

  const handleSignOut = async () => {
    safeStorage.removeItem('motoride_passenger_session');
    await appwriteAuth.signOut();
    setCurrentUser(null);
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col">
        <div className="bg-emerald-950/60 border-b border-emerald-500/20 px-4 py-2 text-center text-xs text-emerald-300 font-medium">
          👤 <strong>Route Passenger Application</strong> • Sign in or register as a Passenger to book bike rides and couriers
        </div>
        <AuthPage
          onAuthenticated={handleAuthenticated}
          defaultRole="passenger"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      <AppSuiteHeader
        appName="Passenger Application"
        currentRole="passenger"
        currentUser={currentUser}
        onSignOut={handleSignOut}
        onOpenWallet={() => setIsWalletOpen(true)}
      />

      <main className="flex-1 w-full relative">
        <PassengerWorkspace
          currentPassengerId={currentUser.id}
          passengerName={currentUser.name}
          currentUser={currentUser}
          onOpenWallet={() => setIsWalletOpen(true)}
          onSignOut={handleSignOut}
        />
      </main>

      <WalletModal
        isOpen={isWalletOpen}
        onClose={() => setIsWalletOpen(false)}
        userId={currentUser.id}
        userRole="passenger"
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
