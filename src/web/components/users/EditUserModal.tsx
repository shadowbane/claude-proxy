import { useState, useEffect } from 'react';
import type { User, UserUpdate } from '@shared/types';

interface EditUserModalProps {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onSubmit: (data: UserUpdate) => Promise<void>;
}

export function EditUserModal({ open, user, onClose, onSubmit }: EditUserModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [quotaMode, setQuotaMode] = useState<'default' | 'custom' | 'unlimited'>('default');
  const [quotaValue, setQuotaValue] = useState('');
  const [creditMode, setCreditMode] = useState<'default' | 'custom' | 'unlimited'>('default');
  const [creditValue, setCreditValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !user) return;
    setName(user.name);
    setEmail(user.email ?? '');
    if (user.daily_token_quota === null) {
      setQuotaMode('default');
      setQuotaValue('');
    } else if (user.daily_token_quota === -1) {
      setQuotaMode('unlimited');
      setQuotaValue('');
    } else {
      setQuotaMode('custom');
      setQuotaValue(user.daily_token_quota.toString());
    }
    if (user.credit_limit === null) {
      setCreditMode('default');
      setCreditValue('');
    } else if (user.credit_limit === -1) {
      setCreditMode('unlimited');
      setCreditValue('');
    } else {
      setCreditMode('custom');
      setCreditValue(user.credit_limit.toString());
    }
    setSubmitting(false);
    setErrors({});
  }, [open, user]);

  if (!open || !user) return null;

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Name is required';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const update: UserUpdate = {};
      if (name.trim() !== user.name) update.name = name.trim();
      if ((email.trim() || '') !== (user.email ?? '')) update.email = email.trim();
      if (quotaMode === 'custom') {
        const parsed = parseInt(quotaValue, 10);
        if (!isNaN(parsed) && parsed !== user.daily_token_quota) update.daily_token_quota = parsed;
      } else if (quotaMode === 'unlimited') {
        if (user.daily_token_quota !== -1) update.daily_token_quota = -1;
      } else {
        if (user.daily_token_quota !== null) update.daily_token_quota = null;
      }
      if (creditMode === 'custom') {
        const parsed = parseInt(creditValue, 10);
        if (!isNaN(parsed) && parsed !== user.credit_limit) update.credit_limit = parsed;
      } else if (creditMode === 'unlimited') {
        if (user.credit_limit !== -1) update.credit_limit = -1;
      } else {
        if (user.credit_limit !== null) update.credit_limit = null;
      }
      if (Object.keys(update).length > 0) {
        await onSubmit(update);
      }
      onClose();
    } catch {
      // parent surfaces error
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = (field: string) =>
    `w-full px-3 py-2 bg-slate-700 border rounded-md text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60 ${
      errors[field] ? 'border-red-500' : 'border-slate-600'
    }`;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-md shadow-2xl">
        <div className="p-5 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-slate-100">Edit User</h3>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass('name')}
              autoFocus
            />
            {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass('email')}
              placeholder="user@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Daily Token Quota</label>
            <select
              value={quotaMode}
              onChange={(e) => setQuotaMode(e.target.value as 'default' | 'custom' | 'unlimited')}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/60 mb-2"
            >
              <option value="default">Use global default</option>
              <option value="custom">Custom limit</option>
              <option value="unlimited">Unlimited</option>
            </select>
            {quotaMode === 'custom' && (
              <input
                type="number"
                value={quotaValue}
                onChange={(e) => setQuotaValue(e.target.value)}
                className={inputClass('quota')}
                placeholder="e.g. 1000000"
                min={0}
                step={1}
              />
            )}
            <p className="mt-1 text-xs text-slate-500">
              {quotaMode === 'default' && 'Inherits the global default limit from Settings.'}
              {quotaMode === 'custom' && 'Maximum total tokens per day for this user.'}
              {quotaMode === 'unlimited' && 'No daily limit, even if a global default is set.'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Monthly MiMo Credit Limit</label>
            <select
              value={creditMode}
              onChange={(e) => setCreditMode(e.target.value as 'default' | 'custom' | 'unlimited')}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/60 mb-2"
            >
              <option value="default">Use global default</option>
              <option value="custom">Custom limit</option>
              <option value="unlimited">Unlimited</option>
            </select>
            {creditMode === 'custom' && (
              <input
                type="number"
                value={creditValue}
                onChange={(e) => setCreditValue(e.target.value)}
                className={inputClass('credit')}
                placeholder="e.g. 100000000"
                min={0}
                step={1}
              />
            )}
            <p className="mt-1 text-xs text-slate-500">
              {creditMode === 'default' && 'Inherits the global credit default from Settings.'}
              {creditMode === 'custom' && 'Max mimo-v2-pro credits per monthly window (2× tokens for all types incl. cache reads).'}
              {creditMode === 'unlimited' && 'No monthly credit limit, even if a global default is set.'}
            </p>
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
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
