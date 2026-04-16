import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api.js';

// Matches the actual shape returned by getStats() on the server
export interface ServerUsageStats {
  total: number;
  success: number;
  errors: number;
  avgLatencyMs: number | null;
  promptTokens: number;
  completionTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

// Matches the actual shape returned by getUsageByUser() on the server
export interface ServerUserUsage {
  user_id: string;
  user_name: string;
  total_requests: number;
  success: number;
  errors: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  last_used_at: string | null;
}

export function useUsage(start?: Date, end?: Date) {
  const [stats, setStats] = useState<ServerUsageStats | null>(null);
  const [byUser, setByUser] = useState<ServerUserUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startIso = start?.toISOString();
  const endIso = end?.toISOString();

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = startIso && endIso
        ? `?${new URLSearchParams({ start: startIso, end: endIso }).toString()}`
        : '';
      const [statsRes, byUserRes] = await Promise.all([
        api.get<ServerUsageStats>(`/usage/stats${qs}`),
        api.get<ServerUserUsage[]>(`/usage/by-user${qs}`),
      ]);
      setStats(statsRes);
      setByUser(byUserRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  }, [startIso, endIso]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { stats, byUser, loading, error, refetch };
}
