import { useState, useEffect } from 'react';

interface CreateTokenModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name?: string) => Promise<{ raw_token: string }>;
}

export function CreateTokenModal({ open, onClose, onCreate }: CreateTokenModalProps) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setSubmitting(false);
    setRawToken(null);
    setCopied(false);
  }, [open]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await onCreate(name.trim() || undefined);
      setRawToken(result.raw_token);
    } catch {
      // parent surfaces error
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = () => {
    if (!rawToken) return;
    navigator.clipboard.writeText(rawToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // insecure context
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-md shadow-2xl">
        <div className="p-5 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-slate-100">
            {rawToken ? 'Token Created' : 'Create API Token'}
          </h3>
        </div>

        {rawToken ? (
          <div className="p-5 space-y-4">
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
              <p className="text-xs text-yellow-300 font-medium mb-1">
                Copy this token now. You won't be able to see it again.
              </p>
            </div>
            <div className="relative">
              <code className="block bg-slate-900 border border-slate-700 rounded-md px-3 py-3 text-xs font-mono text-green-400 break-all select-all">
                {rawToken}
              </code>
            </div>
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-700">
              <button
                onClick={handleCopy}
                className="px-4 py-2 text-sm rounded-md bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
              >
                {copied ? 'Copied!' : 'Copy Token'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Token Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                placeholder="e.g. claude-code, dev-machine (default: 'default')"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-700">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {submitting ? 'Creating...' : 'Create Token'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
