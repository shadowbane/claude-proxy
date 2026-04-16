import { useState, useEffect, useCallback } from 'react';
import type { QuotaOverride, QuotaOverrideCreate } from '@shared/types';
import { api } from '@/lib/api.js';

export function useQuotaOverrides(userId: string | undefined) {
  const [overrides, setOverrides] = useState<QuotaOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<QuotaOverride[]>(`/users/${userId}/quota-overrides`);
      setOverrides(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch overrides');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const createOverride = useCallback(
    async (data: QuotaOverrideCreate): Promise<QuotaOverride> => {
      const result = await api.post<QuotaOverride>(`/users/${userId}/quota-overrides`, data);
      await refetch();
      return result;
    },
    [userId, refetch],
  );

  const deleteOverride = useCallback(
    async (overrideId: string): Promise<void> => {
      await api.del(`/users/${userId}/quota-overrides/${overrideId}`);
      await refetch();
    },
    [userId, refetch],
  );

  return { overrides, loading, error, refetch, createOverride, deleteOverride };
}
