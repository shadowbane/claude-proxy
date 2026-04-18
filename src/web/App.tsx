import { lazy, Suspense, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth.js';
import { AuthGuard } from './components/layout/AuthGuard.js';
import { LoginPage } from './components/auth/LoginPage.js';
import { Sidebar } from './components/layout/Sidebar.js';
import { Header } from './components/layout/Header.js';

const UsageDashboard = lazy(() =>
  import('./components/dashboard/UsageDashboard.js').then((m) => ({ default: m.UsageDashboard })),
);
const UsersPage = lazy(() =>
  import('./components/users/UsersPage.js').then((m) => ({ default: m.UsersPage })),
);
const UserDetailPage = lazy(() =>
  import('./components/users/UserDetailPage.js').then((m) => ({ default: m.UserDetailPage })),
);
const LogsPage = lazy(() =>
  import('./components/logs/LogsPage.js').then((m) => ({ default: m.LogsPage })),
);
const SettingsPage = lazy(() =>
  import('./components/settings/SettingsPage.js').then((m) => ({ default: m.SettingsPage })),
);

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/users': 'Users',
  '/logs': 'Logs',
  '/settings': 'Settings',
};

function resolveTitle(pathname: string): string {
  if (pathname.startsWith('/users/')) return 'User Detail';
  return PAGE_TITLES[pathname] ?? 'Claude Proxy';
}

function RouteFallback() {
  return <div className="p-4 md:p-6 text-slate-500 text-sm">Loading…</div>;
}

function Layout({ onLogout }: { onLogout: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const title = resolveTitle(location.pathname);

  return (
    <div className="flex h-screen bg-slate-900 overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} onLogout={onLogout} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header title={title} onMenuToggle={() => setMobileOpen((prev) => !prev)} />
        <main className="flex-1 overflow-auto">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<UsageDashboard />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/users/:id" element={<UserDetailPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export function App() {
  const { user, loading, login, logout } = useAuth();

  return (
    <AuthGuard
      authenticated={user !== null}
      loading={loading}
      fallback={<LoginPage onLogin={login} />}
    >
      <Layout onLogout={logout} />
    </AuthGuard>
  );
}
