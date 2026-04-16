import type { QuotaStatus } from '@shared/types';

interface QuotaStatusCardProps {
  status: QuotaStatus | null;
  loading: boolean;
}

const numberFmt = new Intl.NumberFormat();

export function QuotaStatusCard({ status, loading }: QuotaStatusCardProps) {
  if (loading) {
    return (
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-5">
        <p className="text-sm text-slate-500">Loading quota...</p>
      </div>
    );
  }

  if (!status || status.quota_limit === null) {
    return (
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">Daily Token Quota</h3>
        <p className="text-lg font-semibold text-slate-300">Unlimited</p>
        <p className="text-xs text-slate-500 mt-1">No daily limit configured</p>
      </div>
    );
  }

  const { quota_limit, tokens_used, tokens_remaining, quota_source, window_end } = status;
  const pct = Math.min(100, (tokens_used / quota_limit) * 100);
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-green-500';
  const textColor = pct >= 90 ? 'text-red-400' : pct >= 75 ? 'text-yellow-400' : 'text-green-400';

  return (
    <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Daily Token Quota</h3>
        {quota_source === 'override' && (
          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-purple-500/15 text-purple-400">
            Override Active
          </span>
        )}
        {quota_source === 'default' && (
          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-slate-700 text-slate-400">
            Global Default
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2 mb-3">
        <span className={`text-2xl font-bold ${textColor}`}>
          {numberFmt.format(tokens_used)}
        </span>
        <span className="text-sm text-slate-500">
          / {numberFmt.format(quota_limit)}
        </span>
      </div>

      <div className="w-full bg-slate-700 rounded-full h-2.5 mb-3">
        <div
          className={`h-2.5 rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{tokens_remaining !== null ? `${numberFmt.format(tokens_remaining)} remaining` : ''}</span>
        <span>Resets at {window_end} UTC</span>
      </div>
    </div>
  );
}
