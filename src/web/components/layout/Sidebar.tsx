import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '@/lib/api.js';

interface HealthStatus {
  status: string;
  timestamp: string;
}

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
}

const NAV_ITEMS: { to: string; label: string; end?: boolean; icon: React.ReactNode }[] = [
  {
    to: '/',
    label: 'Dashboard',
    end: true,
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    to: '/users',
    label: 'Users',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    to: '/logs',
    label: 'Logs',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9h6m-6 4h6m-6-8h6" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export function Sidebar({ mobileOpen, onClose, onLogout }: SidebarProps) {
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    api.get<HealthStatus>('/health').then(setHealth).catch(() => setHealth(null));
  }, []);

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={onClose} />
      )}
      <aside
        className={`
          fixed md:static inset-y-0 left-0 z-50
          w-60 bg-slate-900 border-r border-slate-700/60
          flex flex-col
          transform transition-transform duration-200 ease-in-out
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        <div className="p-4 flex items-center gap-2.5 border-b border-slate-700/60">
          <span className="text-lg font-bold text-slate-100 tracking-tight">Claude Proxy</span>
        </div>

        <nav className="flex-1 py-4 space-y-1">
          {NAV_ITEMS.map(({ to, label, end, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`
              }
            >
              {icon}
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-700/60 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${health ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-slate-500 text-xs">{health ? 'API Healthy' : 'Disconnected'}</span>
          </div>
          <button
            onClick={onLogout}
            className="w-full px-3 py-1.5 text-xs font-medium rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors text-left"
          >
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
