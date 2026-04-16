import { useState, useEffect, useCallback } from 'react';
import type { User, UserCreate, UserUpdate } from '@shared/types';
import { api } from '@/lib/api.js';

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<User[]>('/users');
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const addUser = useCallback(
    async (data: UserCreate): Promise<User> => {
      const result = await api.post<User>('/users', data);
      await refetch();
      return result;
    },
    [refetch],
  );

  const updateUser = useCallback(
    async (id: string, data: UserUpdate): Promise<User> => {
      const result = await api.put<User>(`/users/${id}`, data);
      await refetch();
      return result;
    },
    [refetch],
  );

  const deleteUser = useCallback(
    async (id: string): Promise<void> => {
      await api.del(`/users/${id}`);
      await refetch();
    },
    [refetch],
  );

  const toggleEnabled = useCallback(
    async (id: string, enabled: boolean): Promise<User> => {
      return updateUser(id, { enabled });
    },
    [updateUser],
  );

  return { users, loading, error, refetch, addUser, updateUser, deleteUser, toggleEnabled };
}
