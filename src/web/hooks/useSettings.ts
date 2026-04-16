import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api.js';

export function useSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Record<string, string>>('/settings');
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const save = useCallback(
    async (patch: Record<string, string>): Promise<Record<string, string>> => {
      const data = await api.put<Record<string, string>>('/settings', patch);
      setSettings(data);
      return data;
    },
    [],
  );

  return { settings, loading, error, refetch, save };
}
