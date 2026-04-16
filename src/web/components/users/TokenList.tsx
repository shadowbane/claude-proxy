import { useState } from 'react';
import type { ApiTokenMasked } from '@shared/types';
import { ConfirmDialog } from '../shared/ConfirmDialog.js';

function formatDate(value: string | null): string {
  if (!value) return 'never';
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

interface TokenListProps {
  tokens: ApiTokenMasked[];
  loading: boolean;
  onRevoke: (tokenId: string) => Promise<void>;
  onToggle: (tokenId: string, enabled: boolean) => Promise<void>;
  onReveal: (tokenId: string) => Promise<string>;
  onCreate: () => void;
}

export function TokenList({ tokens, loading, onRevoke, onToggle, onReveal, onCreate }: TokenListProps) {
  const [pendingRevoke, setPendingRevoke] = useState<ApiTokenMasked | null>(null);
  const [revealedTokens, setRevealedTokens] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);

  const handleReveal = async (token: ApiTokenMasked) => {
    if (revealedTokens[token.id]) {
      setRevealedTokens((prev) => {
        const next = { ...prev };
        delete next[token.id];
        return next;
      });
      return;
    }
    setRevealing(token.id);
    try {
      const raw = await onReveal(token.id);
      setRevealedTokens((prev) => ({ ...prev, [token.id]: raw }));
    } finally {
      setRevealing(null);
    }
  };

  const handleCopy = (value: string) => {
    navigator.clipboard.writeText(value).catch(() => {});
  };

  return (
    <div className="bg-slate-800 border border-slate-700/60 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60">
        <h3 className="text-sm font-medium text-slate-300">API Tokens</h3>
        <button
          onClick={onCreate}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          + New Token
        </button>
      </div>

      {loading ? (
        <div className="px-4 py-6 text-center text-slate-500 text-sm">Loading...</div>
      ) : tokens.length === 0 ? (
        <div className="px-4 py-6 text-center text-slate-500 text-sm">
          No tokens yet. Create one to get started.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-slate-400">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Name</th>
                <th className="text-left px-4 py-2.5 font-medium">Prefix</th>
                <th className="text-left px-4 py-2.5 font-medium">Last Used</th>
                <th className="text-center px-4 py-2.5 font-medium">Enabled</th>
                <th className="text-right px-4 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/60">
              {tokens.map((token) => (
                <tr key={token.id} className="hover:bg-slate-800/60">
                  <td className="px-4 py-2.5 text-slate-200 font-medium">{token.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                    {revealedTokens[token.id] ? (
                      <span className="text-green-400 break-all">{revealedTokens[token.id]}</span>
                    ) : (
                      <>{token.token_prefix}...</>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">
                    {formatDate(token.last_used_at)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => onToggle(token.id, !token.enabled)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        token.enabled ? 'bg-green-500' : 'bg-slate-600'
                      }`}
                      aria-label={token.enabled ? 'Disable' : 'Enable'}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                          token.enabled ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleReveal(token)}
                        disabled={revealing === token.id}
                        className="px-2.5 py-1 text-xs font-medium rounded bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors disabled:opacity-50"
                      >
                        {revealing === token.id ? '...' : revealedTokens[token.id] ? 'Hide' : 'Reveal'}
                      </button>
                      {revealedTokens[token.id] && (
                        <button
                          onClick={() => handleCopy(revealedTokens[token.id])}
                          className="px-2.5 py-1 text-xs font-medium rounded bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                        >
                          Copy
                        </button>
                      )}
                      <button
                        onClick={() => setPendingRevoke(token)}
                        className="px-2.5 py-1 text-xs font-medium rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        Revoke
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={pendingRevoke !== null}
        title="Revoke Token"
        message={`Revoke token "${pendingRevoke?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Revoke"
        variant="danger"
        onCancel={() => setPendingRevoke(null)}
        onConfirm={async () => {
          if (pendingRevoke) {
            await onRevoke(pendingRevoke.id);
            setPendingRevoke(null);
          }
        }}
      />
    </div>
  );
}
