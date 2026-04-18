import { Skeleton } from '../shared/Skeleton.js';

export function StatCard({ label, value, loading = false }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">{label}</p>
      {loading ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <p className="text-2xl font-bold text-slate-100">{value}</p>
      )}
    </div>
  );
}
