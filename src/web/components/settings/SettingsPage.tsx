import { useState } from 'react';
import { api } from '@/lib/api.js';

export function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'New password must be at least 6 characters' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    setSaving(true);
    try {
      await api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setMessage({ type: 'success', text: 'Password changed successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to change password' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-6">
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-6">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Server Info</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 w-32 shrink-0">Proxy Endpoint</span>
            <code className="flex-1 bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-blue-400 select-all">
              {window.location.origin}
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 w-32 shrink-0">Messages API</span>
            <code className="flex-1 bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-blue-400 select-all">
              {window.location.origin}/v1/messages
            </code>
          </div>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-6">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Change Password</h3>

        {message && (
          <div
            className={`mb-4 px-4 py-3 rounded-lg text-sm ${
              message.type === 'success'
                ? 'bg-green-900/30 border border-green-800/60 text-green-300'
                : 'bg-red-900/30 border border-red-800/60 text-red-300'
            }`}
          >
            {message.text}
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
              autoComplete="new-password"
            />
          </div>
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
