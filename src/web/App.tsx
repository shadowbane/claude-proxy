import { useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth.js';
import { AuthGuard } from './components/layout/AuthGuard.js';
import { LoginPage } from './components/auth/LoginPage.js';
import { Sidebar } from './components/layout/Sidebar.js';
import { Header } from './components/layout/Header.js';
import { UsageDashboard } from './components/dashboard/UsageDashboard.js';
import { UsersPage } from './components/users/UsersPage.js';
import { UserDetailPage } from './components/users/UserDetailPage.js';
import { LogsPage } from './components/logs/LogsPage.js';
import { SettingsPage } from './components/settings/SettingsPage.js';

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
          <Routes>
            <Route path="/" element={<UsageDashboard />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/:id" element={<UserDetailPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
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
