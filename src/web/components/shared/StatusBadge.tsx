type StatusType = 'success' | 'error' | 'warning' | 'loading' | 'unknown';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
}

const config: Record<StatusType, { dot: string; text: string; defaultLabel: string }> = {
  success: { dot: 'bg-green-500', text: 'text-green-400', defaultLabel: 'Success' },
  error: { dot: 'bg-red-500', text: 'text-red-400', defaultLabel: 'Error' },
  warning: { dot: 'bg-yellow-500', text: 'text-yellow-400', defaultLabel: 'Warning' },
  loading: { dot: 'bg-blue-500 animate-pulse', text: 'text-blue-400', defaultLabel: 'Loading' },
  unknown: { dot: 'bg-slate-500', text: 'text-slate-400', defaultLabel: 'Unknown' },
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const c = config[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${c.text}`}>
      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
      {label ?? c.defaultLabel}
    </span>
  );
}
