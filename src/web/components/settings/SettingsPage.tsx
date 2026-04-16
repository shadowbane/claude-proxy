import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api.js';
import { useSettings } from '@/hooks/useSettings.js';

interface ApiKeyStatus {
  configured: boolean;
  source: 'database' | 'env' | 'none';
  masked: string | null;
}

interface CleanupResult {
  file: string;
  originalSize: number;
  newSize: number;
  linesRemoved: number;
  linesKept: number;
}

interface CleanupReport {
  ran: boolean;
  reason?: string;
  timestamp: string;
  settings: { enabled: boolean; retentionDays: number; maxSizeMb: number };
  results: CleanupResult[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
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

  // Quota settings state
  const [quotaResetTime, setQuotaResetTime] = useState('00:00');
  const [quotaDefaultLimit, setQuotaDefaultLimit] = useState('');
  const [quotaSaving, setQuotaSaving] = useState(false);
  const [quotaMessage, setQuotaMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Log cleanup state
  const { settings, save: saveSettings } = useSettings();
  const [logCleanupEnabled, setLogCleanupEnabled] = useState(true);
  const [logRetentionDays, setLogRetentionDays] = useState('7');
  const [logMaxSizeMb, setLogMaxSizeMb] = useState('1');
  const [logSaving, setLogSaving] = useState(false);
  const [logMessage, setLogMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [cleanupReport, setCleanupReport] = useState<CleanupReport | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const fetchApiKeyStatus = useCallback(async () => {
    try {
      const data = await api.get<ApiKeyStatus>('/settings/upstream-api-key');
      setApiKeyStatus(data);
    } catch {
      // ignore — page just loaded
    }
  }, []);

  useEffect(() => { fetchApiKeyStatus(); }, [fetchApiKeyStatus]);

  // Sync settings from server
  useEffect(() => {
    if (settings['log_cleanup_enabled'] !== undefined) setLogCleanupEnabled(settings['log_cleanup_enabled'] === 'true');
    if (settings['log_retention_days'] !== undefined) setLogRetentionDays(settings['log_retention_days']);
    if (settings['log_max_size_mb'] !== undefined) setLogMaxSizeMb(settings['log_max_size_mb']);
    if (settings['quota_reset_time'] !== undefined) setQuotaResetTime(settings['quota_reset_time']);
    if (settings['quota_default_limit'] !== undefined) setQuotaDefaultLimit(settings['quota_default_limit']);
  }, [settings]);

  const handleSaveLogSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setLogMessage(null);
    const days = parseInt(logRetentionDays, 10);
    const size = parseFloat(logMaxSizeMb);
    if (isNaN(days) || days < 1) {
      setLogMessage({ type: 'error', text: 'Retention days must be at least 1' });
      return;
    }
    if (isNaN(size) || size < 0.1) {
      setLogMessage({ type: 'error', text: 'Max size must be at least 0.1 MB' });
      return;
    }
    setLogSaving(true);
    try {
      await saveSettings({
        log_cleanup_enabled: String(logCleanupEnabled),
        log_retention_days: String(days),
        log_max_size_mb: String(size),
      });
      setLogMessage({ type: 'success', text: 'Log cleanup settings saved' });
    } catch (err) {
      setLogMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save settings' });
    } finally {
      setLogSaving(false);
    }
  };

  const handleRunCleanup = async () => {
    setCleaning(true);
    setCleanupReport(null);
    try {
      const report = await api.post<CleanupReport>('/settings/log-cleanup', {});
      setCleanupReport(report);
    } catch (err) {
      setLogMessage({ type: 'error', text: err instanceof Error ? err.message : 'Cleanup failed' });
    } finally {
      setCleaning(false);
    }
  };

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

      {/* Log Maintenance */}
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-6">
        <h3 className="text-sm font-medium text-slate-300 mb-1">Log Maintenance</h3>
        <p className="text-xs text-slate-500 mb-4">
          Automatically clean up log files based on age and size. Does not affect request logs in the database.
        </p>

        {logMessage && (
          <div
            className={`mb-4 px-4 py-3 rounded-lg text-sm ${
              logMessage.type === 'success'
                ? 'bg-green-900/30 border border-green-800/60 text-green-300'
                : 'bg-red-900/30 border border-red-800/60 text-red-300'
            }`}
          >
            {logMessage.text}
          </div>
        )}

        <form onSubmit={handleSaveLogSettings} className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={logCleanupEnabled}
                onChange={(e) => setLogCleanupEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/60 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
            </label>
            <span className="text-sm text-slate-300">Enable auto cleanup</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Retention (days)</label>
              <input
                type="number"
                min="1"
                value={logRetentionDays}
                onChange={(e) => setLogRetentionDays(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
              />
              <p className="text-xs text-slate-500 mt-1">Delete entries older than this</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Max file size (MB)</label>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={logMaxSizeMb}
                onChange={(e) => setLogMaxSizeMb(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
              />
              <p className="text-xs text-slate-500 mt-1">Trim oldest entries if exceeded</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleRunCleanup}
              disabled={cleaning}
              className="px-4 py-2 text-sm font-medium rounded-md bg-slate-600 text-slate-200 hover:bg-slate-500 transition-colors disabled:opacity-50"
            >
              {cleaning ? 'Running...' : 'Run Now'}
            </button>
            <button
              type="submit"
              disabled={logSaving}
              className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {logSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>

        {cleanupReport && (
          <div className="mt-4 p-3 bg-slate-900/60 border border-slate-700 rounded-md">
            <p className="text-xs text-slate-400 mb-2">
              Cleanup completed at {new Date(cleanupReport.timestamp).toLocaleString()}
            </p>
            <div className="space-y-1">
              {cleanupReport.results.map((r) => (
                <div key={r.file} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-mono">{r.file}</span>
                  <span className="text-slate-400">
                    {formatBytes(r.originalSize)} &rarr; {formatBytes(r.newSize)}
                    {r.linesRemoved > 0 && (
                      <span className="text-amber-400 ml-2">-{r.linesRemoved} lines</span>
                    )}
                    {r.linesRemoved === 0 && (
                      <span className="text-green-400 ml-2">no change</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quota Settings */}
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-6">
        <h3 className="text-sm font-medium text-slate-300 mb-1">Quota Settings</h3>
        <p className="text-xs text-slate-500 mb-4">
          Configure the global default daily quota and reset time. Per-user quotas override the global default.
        </p>

        {quotaMessage && (
          <div
            className={`mb-4 px-4 py-3 rounded-lg text-sm ${
              quotaMessage.type === 'success'
                ? 'bg-green-900/30 border border-green-800/60 text-green-300'
                : 'bg-red-900/30 border border-red-800/60 text-red-300'
            }`}
          >
            {quotaMessage.text}
          </div>
        )}

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setQuotaMessage(null);
            setQuotaSaving(true);
            try {
              const patch: Record<string, string> = {
                quota_reset_time: quotaResetTime,
                quota_default_limit: quotaDefaultLimit.trim(),
              };
              await saveSettings(patch);
              setQuotaMessage({ type: 'success', text: 'Quota settings saved' });
            } catch (err) {
              setQuotaMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
            } finally {
              setQuotaSaving(false);
            }
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Global Default Limit</label>
              <input
                type="number"
                value={quotaDefaultLimit}
                onChange={(e) => setQuotaDefaultLimit(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                placeholder="No default"
                min={0}
                step={1}
              />
              <p className="text-xs text-slate-500 mt-1">Applies to users without a per-user quota. Leave empty for unlimited.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Daily Reset Time (UTC)</label>
              <input
                type="time"
                value={quotaResetTime}
                onChange={(e) => setQuotaResetTime(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
              />
              <p className="text-xs text-slate-500 mt-1">24-hour UTC format. Default: 00:00</p>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={quotaSaving}
              className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {quotaSaving ? 'Saving...' : 'Save'}
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
