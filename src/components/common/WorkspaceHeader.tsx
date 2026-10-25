import React from 'react';
import { UserRole } from '../../types/motoride';
import {
  User,
  LogOut,
  ArrowLeftRight,
  Shield,
} from 'lucide-react';
import { AuthUser } from '../../types/motoride';

interface WorkspaceHeaderProps {
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  currentUser?: AuthUser | null;
  onSignOut?: () => void;
  walletBalance?: number;
  isCaptainOnline?: boolean;
  onToggleCaptainOnline?: () => void;
  unreadNotificationsCount?: number;
  onOpenNotifications?: () => void;
  onOpenWallet?: () => void;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
  currentRole,
  onRoleChange,
  currentUser,
  onSignOut,
  isCaptainOnline = true,
  onToggleCaptainOnline,
}) => {
  const handleToggleApp = () => {
    if (currentRole === 'passenger') {
      onRoleChange('captain');
    } else {
      onRoleChange('passenger');
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 px-3 sm:px-6 py-2.5 shadow-lg shadow-black/40">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Brand & Active Workspace */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <img
              src="/motoride-logo.png"
              alt="Route"
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-xl object-cover bg-black border border-white/20 shadow-md shadow-black/80 shrink-0"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-extrabold tracking-tight text-white text-base">
                Route
              </span>
              <span className="text-[11px] text-emerald-400 font-semibold hidden xs:inline">
                – Ride & Courier Booking
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wide">
                Live
              </span>
            </div>
          </div>
        </div>

        {/* Center/Right Section: One-Click Switch Button for Passenger App and Captain App modes */}
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          {/* Authoritative App Switcher Tabs: Passenger App vs Captain App */}
          <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-2xl shadow-inner">
            <button
              type="button"
              onClick={() => onRoleChange('passenger')}
              id="tab-header-passenger"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer select-none active:scale-95 ${
                currentRole === 'passenger'
                  ? 'bg-emerald-500 text-slate-950 shadow-md font-black'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
              }`}
              title="Switch to Passenger App"
            >
              <User className="w-3.5 h-3.5" />
              <span>Passenger</span>
            </button>

            <button
              type="button"
              onClick={() => onRoleChange('captain')}
              id="tab-header-captain"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer select-none active:scale-95 ${
                currentRole === 'captain'
                  ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
              }`}
              title="Switch to Captain App"
            >
              <div className="w-3.5 h-3.5 rounded bg-black/40 flex items-center justify-center p-0.5 shrink-0">
                <img
                  src="/captain-bike-icon.svg"
                  alt="Captain"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain"
                />
              </div>
              <span>Captain</span>
            </button>

            {currentUser?.role === 'admin' && (
              <button
                type="button"
                onClick={() => onRoleChange('admin')}
                id="tab-header-admin"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer select-none active:scale-95 ${
                  currentRole === 'admin'
                    ? 'bg-purple-600 text-white shadow-md font-black'
                    : 'text-purple-300 hover:text-white hover:bg-purple-950/40'
                }`}
                title="Switch to Admin Dashboard"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Admin</span>
              </button>
            )}
          </div>


            {/* Captain Online/Offline Pill (Visible when Captain App is Active) */}
            {currentRole === 'captain' && onToggleCaptainOnline && (
              <button
                type="button"
                onClick={onToggleCaptainOnline}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border shadow-sm select-none active:scale-95 ${
                  isCaptainOnline
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                }`}
                title={isCaptainOnline ? 'Status: Online (Click to go Offline)' : 'Status: Offline (Click to go Online)'}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isCaptainOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                  }`}
                />
                <span>{isCaptainOnline ? 'Online' : 'Offline'}</span>
              </button>
            )}

          {/* User Account Info & Sign Out */}
          {currentUser && (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
              <div className="hidden lg:flex flex-col text-right">
                <span className="text-xs font-bold text-white truncate max-w-[120px]">
                  {currentUser.name}
                </span>
                <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                  {currentUser.email}
                </span>
              </div>

              {onSignOut && (
                <button
                  type="button"
                  onClick={onSignOut}
                  title="Sign Out from Supabase session"
                  aria-label="Sign Out"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-rose-500/25 text-xs font-bold transition-all cursor-pointer active:scale-95 shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sign Out</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
