import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api.js';

interface ApiKeyStatus {
  configured: boolean;
  source: 'database' | 'env' | 'none';
  masked: string | null;
}

export function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Upstream API key state
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyMessage, setApiKeyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchApiKeyStatus = useCallback(async () => {
    try {
      const data = await api.get<ApiKeyStatus>('/settings/upstream-api-key');
      setApiKeyStatus(data);
    } catch {
      // ignore — page just loaded
    }
  }, []);

  useEffect(() => { fetchApiKeyStatus(); }, [fetchApiKeyStatus]);

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiKeyMessage(null);
    if (!apiKeyInput.trim()) {
      setApiKeyMessage({ type: 'error', text: 'API key cannot be empty' });
      return;
    }
    setApiKeySaving(true);
    try {
      const data = await api.put<ApiKeyStatus>('/settings/upstream-api-key', { value: apiKeyInput.trim() });
      setApiKeyStatus(data);
      setApiKeyInput('');
      setApiKeyMessage({ type: 'success', text: 'Upstream API key saved' });
    } catch (err) {
      setApiKeyMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save API key' });
    } finally {
      setApiKeySaving(false);
    }
  };

  const handleClearApiKey = async () => {
    setApiKeyMessage(null);
    setApiKeySaving(true);
    try {
      const data = await api.del<ApiKeyStatus>('/settings/upstream-api-key');
      setApiKeyStatus(data);
      setApiKeyMessage({ type: 'success', text: 'Database key removed — using .env fallback' });
    } catch (err) {
      setApiKeyMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to clear API key' });
    } finally {
      setApiKeySaving(false);
    }
  };

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

      {/* Upstream API Key */}
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-6">
        <h3 className="text-sm font-medium text-slate-300 mb-1">Upstream API Key</h3>
        <p className="text-xs text-slate-500 mb-4">
          The shared API key used to authenticate with the upstream provider. Database value takes priority over .env.
        </p>

        {apiKeyMessage && (
          <div
            className={`mb-4 px-4 py-3 rounded-lg text-sm ${
              apiKeyMessage.type === 'success'
                ? 'bg-green-900/30 border border-green-800/60 text-green-300'
                : 'bg-red-900/30 border border-red-800/60 text-red-300'
            }`}
          >
            {apiKeyMessage.text}
          </div>
        )}

        {apiKeyStatus && (
          <div className="mb-4 flex items-center gap-3">
            <span className={`inline-block w-2 h-2 rounded-full ${apiKeyStatus.configured ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-xs text-slate-400">
              {apiKeyStatus.configured
                ? <>Source: <span className="text-slate-300 font-medium">{apiKeyStatus.source}</span> &mdash; <code className="text-blue-400">{apiKeyStatus.masked}</code></>
                : 'Not configured'}
            </span>
          </div>
        )}

        <form onSubmit={handleSaveApiKey} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">New API Key</label>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Enter upstream API key"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
              autoComplete="off"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            {apiKeyStatus?.source === 'database' && (
              <button
                type="button"
                onClick={handleClearApiKey}
                disabled={apiKeySaving}
                className="px-4 py-2 text-sm font-medium rounded-md bg-slate-600 text-slate-200 hover:bg-slate-500 transition-colors disabled:opacity-50"
              >
                Clear DB Key
              </button>
            )}
            <button
              type="submit"
              disabled={apiKeySaving}
              className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {apiKeySaving ? 'Saving...' : 'Save Key'}
            </button>
          </div>
        </form>
      </div>

      {/* Change Password */}
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
