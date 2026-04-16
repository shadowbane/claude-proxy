import type { ReactNode } from 'react';

interface AuthGuardProps {
  authenticated: boolean;
  loading: boolean;
  children: ReactNode;
  fallback: ReactNode;
}

export function AuthGuard({ authenticated, loading, children, fallback }: AuthGuardProps) {
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <p className="text-slate-500 text-sm">Loading...</p>
      </div>
    );
  }

  if (!authenticated) return <>{fallback}</>;
  return <>{children}</>;
}
