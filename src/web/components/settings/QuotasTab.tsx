import { useState, useEffect } from 'react';
import { useSettings } from '@/hooks/useSettings.js';

export function QuotasTab() {
  const { settings, save: saveSettings } = useSettings();
  const [quotaResetTime, setQuotaResetTime] = useState('00:00');
  const [quotaDefaultLimit, setQuotaDefaultLimit] = useState('');
  const [creditDefaultLimit, setCreditDefaultLimit] = useState('');
  const [creditResetDay, setCreditResetDay] = useState('1');
  const [quotaSaving, setQuotaSaving] = useState(false);
  const [quotaMessage, setQuotaMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (settings['quota_reset_time'] !== undefined) setQuotaResetTime(settings['quota_reset_time']);
    if (settings['quota_default_limit'] !== undefined) setQuotaDefaultLimit(settings['quota_default_limit']);
    if (settings['credit_limit_default'] !== undefined) setCreditDefaultLimit(settings['credit_limit_default']);
    if (settings['credit_reset_day'] !== undefined) setCreditResetDay(settings['credit_reset_day']);
  }, [settings]);

  return (
    <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-6">
      <h3 className="text-sm font-medium text-slate-300 mb-1">Quota & Credit Settings</h3>
      <p className="text-xs text-slate-500 mb-4">
        Daily token quota (Anthropic-style, excludes cache reads) and monthly MiMo credit limit
        (billed-equivalent, includes cache reads × 2) are enforced independently. Per-user values
        override these global defaults.
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
              credit_limit_default: creditDefaultLimit.trim(),
              credit_reset_day: creditResetDay.trim(),
            };
            await saveSettings(patch);
            setQuotaMessage({ type: 'success', text: 'Settings saved' });
          } catch (err) {
            setQuotaMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
          } finally {
            setQuotaSaving(false);
          }
        }}
        className="space-y-6"
      >
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Daily Token Quota</h4>
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
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Monthly MiMo Credit Limit</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Global Default Limit</label>
              <input
                type="number"
                value={creditDefaultLimit}
                onChange={(e) => setCreditDefaultLimit(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                placeholder="No default (-1 = explicitly unlimited)"
                min={-1}
                step={1}
              />
              <p className="text-xs text-slate-500 mt-1">
                mimo-v2-pro credits per monthly window. Empty = unlimited, <code>-1</code> = explicit unlimited.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Monthly Reset Day (UTC)</label>
              <input
                type="number"
                value={creditResetDay}
                onChange={(e) => setCreditResetDay(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                min={1}
                max={28}
                step={1}
              />
              <p className="text-xs text-slate-500 mt-1">Day of month (1–28) when the credit window resets at 00:00 UTC. Default: 1.</p>
            </div>
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
  );
}
