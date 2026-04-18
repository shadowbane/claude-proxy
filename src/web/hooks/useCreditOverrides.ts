import { useState, useEffect, useCallback } from 'react';
import type { CreditOverride, CreditOverrideCreate } from '@shared/types';
import { api } from '@/lib/api.js';

export function useCreditOverrides(userId: string | undefined) {
  const [overrides, setOverrides] = useState<CreditOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<CreditOverride[]>(`/users/${userId}/credit-overrides`);
      setOverrides(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch credit overrides');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const createOverride = useCallback(
    async (data: CreditOverrideCreate): Promise<CreditOverride> => {
      const result = await api.post<CreditOverride>(`/users/${userId}/credit-overrides`, data);
      await refetch();
      return result;
    },
    [userId, refetch],
  );

  const deleteOverride = useCallback(
    async (overrideId: string): Promise<void> => {
      await api.del(`/users/${userId}/credit-overrides/${overrideId}`);
      await refetch();
    },
    [userId, refetch],
  );

  return { overrides, loading, error, refetch, createOverride, deleteOverride };
}
