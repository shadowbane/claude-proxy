import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api.js';

interface AuthUser {
  id: string;
  username: string;
  created_at: string;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<AuthUser>('/auth/me');
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.post<AuthUser>('/auth/login', { username, password });
    setUser({ ...data, created_at: '' });
    return data;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  return { user, loading, login, logout };
}
