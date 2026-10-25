import React, { useState } from 'react';
import { UserRole } from '../../types/motoride';
import {
  User,
  LogOut,
  ExternalLink,
  Shield,
  Layers,
  Sparkles,
  ChevronDown,
  Database,
} from 'lucide-react';
import { AuthUser } from '../../lib/appwriteAuth';
import { appwriteProjectId, isAppwriteConfigured } from '../../lib/appwrite';
import { AppwriteConfigModal } from './AppwriteConfigModal';

interface AppSuiteHeaderProps {
  appName: 'Passenger Application' | 'Captain Application' | 'Admin Console';
  currentRole: UserRole;
  currentUser?: AuthUser | null;
  onSignOut?: () => void;
  onOpenWallet?: () => void;
  isCaptainOnline?: boolean;
  onToggleCaptainOnline?: () => void;
}

export const AppSuiteHeader: React.FC<AppSuiteHeaderProps> = ({
  appName,
  currentRole,
  currentUser,
  onSignOut,
}) => {
  const [showAppsMenu, setShowAppsMenu] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);

  const apps = [
    {
      id: 'passenger',
      title: 'Passenger App',
      role: 'passenger',
      url: '/passenger',
      desc: 'Book rides, couriers & fare bidding',
      icon: '👤',
      badgeColor: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10',
    },
    {
      id: 'captain',
      title: 'Captain App',
      role: 'captain',
      url: '/captain',
      desc: 'Live ride requests, navigation & earnings',
      icon: '🏍️',
      badgeColor: 'border-amber-500/40 text-amber-300 bg-amber-500/10',
    },
    {
      id: 'admin',
      title: 'Admin Console',
      role: 'admin',
      url: '/admin',
      desc: 'Platform settings, fleet & commissions',
      icon: '🛡️',
      badgeColor: 'border-purple-500/40 text-purple-300 bg-purple-500/10',
    },
  ];

  return (
    <>
      <header className="sticky top-0 z-50 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 px-3 sm:px-6 py-2.5 shadow-lg shadow-black/40">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          {/* Brand & App Identity */}
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
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold tracking-tight text-white text-base">
                    Route
                  </span>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-lg border ${
                      currentRole === 'passenger'
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : currentRole === 'captain'
                        ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                        : 'bg-purple-500/15 border-purple-500/30 text-purple-300'
                    }`}
                  >
                    {appName}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400">
                  Independent Web Application • Appwrite Cloud Backend
                </div>
              </div>
            </div>
          </div>

          {/* Center / Right Section: Appwrite Config, App Switcher & User Account */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Appwrite Status Button */}
            <button
              type="button"
              onClick={() => setShowConfigModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-pink-950/40 border border-pink-500/30 hover:border-pink-500/60 text-pink-300 text-xs font-semibold transition-all cursor-pointer active:scale-95"
              title="Click to view or edit Appwrite Database environment variables"
            >
              <Database className="w-3.5 h-3.5 text-pink-400" />
              <span className="hidden sm:inline font-mono text-[11px]">
                {appwriteProjectId.slice(0, 8)}...
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </button>

            {/* App Switcher Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAppsMenu(!showAppsMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 hover:border-slate-600 text-xs text-slate-200 transition-colors cursor-pointer"
                title="View all 3 Route independent applications"
              >
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span className="font-semibold hidden sm:inline">3 Apps Suite</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {showAppsMenu && (
                <div className="absolute right-0 mt-2 w-72 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-2 z-50">
                  <div className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800/80 mb-1 flex items-center justify-between">
                    <span>3 Independent Apps</span>
                    <span className="text-[10px] text-blue-400">Separate URLs</span>
                  </div>
                  <div className="space-y-1">
                    {apps.map((app) => (
                      <a
                        key={app.id}
                        href={app.url}
                        target={app.role === currentRole ? undefined : '_blank'}
                        rel="noopener noreferrer"
                        className={`flex items-start gap-2.5 p-2 rounded-xl transition-all ${
                          app.role === currentRole
                            ? 'bg-slate-800/80 border border-white/10 text-white'
                            : 'hover:bg-slate-800/50 text-slate-300 hover:text-white'
                        }`}
                      >
                        <span className="text-lg mt-0.5">{app.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-1">
                              {app.title}
                              {app.role === currentRole && (
                                <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1.5 rounded border border-blue-500/30">
                                  Current
                                </span>
                              )}
                            </span>
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </div>
                          <p className="text-[10px] text-slate-400 truncate">{app.desc}</p>
                          <span className="text-[9px] text-slate-500 font-mono">{app.url}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* User profile details */}
            {currentUser && (
              <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                <div className="hidden md:flex flex-col text-right">
                  <span className="text-xs font-bold text-slate-200 truncate max-w-[120px]">
                    {currentUser.name}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono truncate max-w-[120px]">
                    {currentUser.email}
                  </span>
                </div>
                {onSignOut && (
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-xs font-medium cursor-pointer transition-colors"
                    title="Sign out of this application"
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

      {/* Appwrite Configuration Modal */}
      <AppwriteConfigModal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
      />
    </>
  );
};
