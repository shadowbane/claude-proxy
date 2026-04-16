import { useState, useEffect, useCallback } from 'react';
import type { RequestLog } from '@shared/types';
import { api } from '@/lib/api.js';

export function useRequestLogs(
  limit: number = 50,
  offset: number = 0,
  start?: Date,
  end?: Date,
  userId?: string,
  status?: string,
) {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startIso = start?.toISOString();
  const endIso = end?.toISOString();

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (startIso) params.set('start', startIso);
      if (endIso) params.set('end', endIso);
      if (userId) params.set('user_id', userId);
      if (status) params.set('status', status);
      const data = await api.get<{ rows: RequestLog[]; total: number }>(`/logs?${params.toString()}`);
      setLogs(data.rows);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [limit, offset, startIso, endIso, userId, status]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { logs, total, loading, error, refetch };
}
