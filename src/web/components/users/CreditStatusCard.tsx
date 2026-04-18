import type { CreditStatus } from '@shared/types';

interface CreditStatusCardProps {
  status: CreditStatus | null;
  loading: boolean;
}

const numberFmt = new Intl.NumberFormat();

export function CreditStatusCard({ status, loading }: CreditStatusCardProps) {
  if (loading) {
    return (
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-5">
        <p className="text-sm text-slate-500">Loading credits...</p>
      </div>
    );
  }

  if (!status || status.credit_limit === null) {
    return (
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">
          Monthly MiMo Credits
        </h3>
        <p className="text-lg font-semibold text-slate-300">Unlimited</p>
        <p className="text-xs text-slate-500 mt-1">No monthly credit limit configured</p>
      </div>
    );
  }

  const { credit_limit, credits_used, credits_remaining, credit_source, window_end, reset_day } = status;
  const pct = credit_limit > 0 ? Math.min(100, (credits_used / credit_limit) * 100) : 100;
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-green-500';
  const textColor = pct >= 90 ? 'text-red-400' : pct >= 75 ? 'text-yellow-400' : 'text-green-400';

  return (
    <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Monthly MiMo Credits
        </h3>
        {credit_source === 'override' && (
          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-purple-500/15 text-purple-400">
            Override Active
          </span>
        )}
        {credit_source === 'default' && (
          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-slate-700 text-slate-400">
            Global Default
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2 mb-3">
        <span className={`text-2xl font-bold ${textColor}`}>
          {numberFmt.format(credits_used)}
        </span>
        <span className="text-sm text-slate-500">
          / {numberFmt.format(credit_limit)}
        </span>
      </div>

      <div className="w-full bg-slate-700 rounded-full h-2.5 mb-3">
        <div
          className={`h-2.5 rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{credits_remaining !== null ? `${numberFmt.format(credits_remaining)} remaining` : ''}</span>
        <span>
          Resets day {reset_day} · next {window_end} UTC
        </span>
      </div>
    </div>
  );
}
