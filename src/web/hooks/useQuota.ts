import { useState, useEffect, useCallback } from 'react';
import type { QuotaStatus } from '@shared/types';
import { api } from '@/lib/api.js';

export function useQuota(userId: string | undefined) {
  const [status, setStatus] = useState<QuotaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<QuotaStatus>(`/users/${userId}/quota`);
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch quota');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { status, loading, error, refetch };
}
