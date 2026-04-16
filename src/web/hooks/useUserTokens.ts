import { useState, useEffect, useCallback } from 'react';
import type { ApiTokenMasked } from '@shared/types';
import { api } from '@/lib/api.js';

export interface TokenCreateResult extends ApiTokenMasked {
  raw_token: string;
}

export function useUserTokens(userId: string | undefined) {
  const [tokens, setTokens] = useState<ApiTokenMasked[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ApiTokenMasked[]>(`/users/${userId}/tokens`);
      setTokens(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tokens');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const createToken = useCallback(
    async (name?: string): Promise<TokenCreateResult> => {
      if (!userId) throw new Error('No user ID');
      const result = await api.post<TokenCreateResult>(`/users/${userId}/tokens`, { name });
      await refetch();
      return result;
    },
    [userId, refetch],
  );

  const revokeToken = useCallback(
    async (tokenId: string): Promise<void> => {
      await api.del(`/tokens/${tokenId}`);
      await refetch();
    },
    [refetch],
  );

  const toggleToken = useCallback(
    async (tokenId: string, enabled: boolean): Promise<void> => {
      await api.put(`/tokens/${tokenId}`, { enabled });
      await refetch();
    },
    [refetch],
  );

  const revealToken = useCallback(async (tokenId: string): Promise<string> => {
    const result = await api.post<{ token: string }>(`/tokens/${tokenId}/reveal`);
    return result.token;
  }, []);

  return { tokens, loading, error, refetch, createToken, revokeToken, toggleToken, revealToken };
}
