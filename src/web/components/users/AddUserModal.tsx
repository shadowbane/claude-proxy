import { useState, useEffect } from 'react';
import type { UserCreate } from '@shared/types';

interface AddUserModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: UserCreate) => Promise<void>;
}

export function AddUserModal({ open, onClose, onSubmit }: AddUserModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setSubmitting(false);
    setErrors({});
  }, [open]);

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
      await onSubmit({ name: name.trim(), email: email.trim() || undefined });
      onClose();
    } catch {
      // parent surfaces error
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const inputClass = (field: string) =>
    `w-full px-3 py-2 bg-slate-700 border rounded-md text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60 ${
      errors[field] ? 'border-red-500' : 'border-slate-600'
    }`;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-md shadow-2xl">
        <div className="p-5 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-slate-100">Add User</h3>
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
              placeholder="e.g. John Doe"
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
              {submitting ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
