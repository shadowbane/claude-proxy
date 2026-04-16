import { useState } from 'react';
import type { QuotaOverrideCreate } from '@shared/types';

interface QuotaOverrideModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: QuotaOverrideCreate) => Promise<unknown>;
}

export function QuotaOverrideModal({ open, onClose, onCreate }: QuotaOverrideModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [maxTokens, setMaxTokens] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!startDate || !endDate) {
      setError('Start and end dates are required');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after start date');
      return;
    }
    const tokens = parseInt(maxTokens, 10);
    if (isNaN(tokens) || tokens < 0) {
      setError('Max tokens must be a non-negative number');
      return;
    }

    setSubmitting(true);
    try {
      await onCreate({
        start_date: startDate,
        end_date: endDate,
        max_tokens: tokens,
        note: note.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create override');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-md shadow-2xl">
        <div className="p-5 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-slate-100">Add Quota Override</h3>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Max Tokens <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className={inputClass}
              placeholder="e.g. 1000000"
              min={0}
              step={1}
              autoFocus
            />
            <p className="mt-1 text-xs text-slate-500">Daily token limit during this period. Use 0 to block all usage.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Note</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
              placeholder="Optional reason"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

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
              {submitting ? 'Creating...' : 'Create Override'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
