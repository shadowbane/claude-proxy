import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api.js';

export interface FileLogEntry {
  time: string;
  level: string;
  msg: string;
  err?: { type?: string; message?: string; stack?: string };
  clientIp?: string;
  raw: string;
}

export type FileLogType = 'app' | 'error';

export function useFileLogs(
  type: FileLogType,
  limit: number,
  offset: number,
  start?: Date,
  end?: Date,
  level?: string,
) {
  const [entries, setEntries] = useState<FileLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startIso = start?.toISOString();
  const endIso = end?.toISOString();

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (startIso && endIso) {
        params.set('start', startIso);
        params.set('end', endIso);
      }
      if (level && level !== 'all') params.set('level', level);
      const res = await api.get<{ entries: FileLogEntry[]; total: number }>(
        `/logs/files/${type}?${params.toString()}`,
      );
      setEntries(res.entries);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [type, limit, offset, startIso, endIso, level]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { entries, total, loading, error, refetch };
}
