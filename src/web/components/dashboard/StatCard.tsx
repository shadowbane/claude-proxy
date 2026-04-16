export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">{label}</p>
      <p className="text-2xl font-bold text-slate-100">{value}</p>
    </div>
  );
}
