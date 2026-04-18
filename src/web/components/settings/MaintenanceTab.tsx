import { useState, useEffect } from 'react';
import { api } from '@/lib/api.js';
import { useSettings } from '@/hooks/useSettings.js';

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

export function MaintenanceTab() {
  const { settings, save: saveSettings } = useSettings();
  const [logCleanupEnabled, setLogCleanupEnabled] = useState(true);
  const [logRetentionDays, setLogRetentionDays] = useState('7');
  const [logMaxSizeMb, setLogMaxSizeMb] = useState('1');
  const [logSaving, setLogSaving] = useState(false);
  const [logMessage, setLogMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [cleanupReport, setCleanupReport] = useState<CleanupReport | null>(null);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    if (settings['log_cleanup_enabled'] !== undefined) setLogCleanupEnabled(settings['log_cleanup_enabled'] === 'true');
    if (settings['log_retention_days'] !== undefined) setLogRetentionDays(settings['log_retention_days']);
    if (settings['log_max_size_mb'] !== undefined) setLogMaxSizeMb(settings['log_max_size_mb']);
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

  return (
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
  );
}
