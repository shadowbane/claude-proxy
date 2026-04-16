import { useState, useEffect, useCallback } from 'react';
import type { TimeSeriesBucket } from '@shared/types';
import { api } from '@/lib/api.js';

export type BucketGranularity = 'hour' | 'day';

export function pickBucket(start: Date, end: Date): BucketGranularity {
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  return days <= 2 ? 'hour' : 'day';
}

export function useTimeSeries(start: Date, end: Date) {
  const [points, setPoints] = useState<TimeSeriesBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const requestedBucket = pickBucket(start, end);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tzOffset = -new Date().getTimezoneOffset();
      const qs = new URLSearchParams({
        start: startIso,
        end: endIso,
        bucket: requestedBucket,
        tz_offset: String(tzOffset),
      });
      const data = await api.get<TimeSeriesBucket[]>(`/usage/timeseries?${qs.toString()}`);
      setPoints(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load time series');
    } finally {
      setLoading(false);
    }
  }, [startIso, endIso, requestedBucket]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { points, loading, error, refetch };
}
