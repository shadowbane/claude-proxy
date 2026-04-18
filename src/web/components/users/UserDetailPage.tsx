import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useUsers } from '@/hooks/useUsers.js';
import { useUserTokens } from '@/hooks/useUserTokens.js';
import { useUserTimeSeries, type TimeSeriesBucket, pickBucket } from '@/hooks/useUserTimeSeries.js';
import { addDays, startOfLocalDay, toDateInput, fromDateInput } from '@/lib/date-range.js';
import { EditUserModal } from './EditUserModal.js';
import { TokenList } from './TokenList.js';
import { CreateTokenModal } from './CreateTokenModal.js';
import { ConfirmDialog } from '../shared/ConfirmDialog.js';
import { QuotaStatusCard } from './QuotaStatusCard.js';
import { CreditStatusCard } from './CreditStatusCard.js';
import { QuotaOverrideModal } from './QuotaOverrideModal.js';
import { CreditOverrideModal } from './CreditOverrideModal.js';
import { useQuota } from '@/hooks/useQuota.js';
import { useCredits } from '@/hooks/useCredits.js';
import { useQuotaOverrides } from '@/hooks/useQuotaOverrides.js';
import { useCreditOverrides } from '@/hooks/useCreditOverrides.js';
import { StatCard } from '../dashboard/StatCard.js';
import { Skeleton } from '../shared/Skeleton.js';

function formatBucket(bucket: string, granularity: 'hour' | 'day'): string {
  const parsed = new Date(bucket.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return bucket;
  if (granularity === 'hour') {
    return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return parsed.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
}

interface MiniChartProps {
  title: string;
  color: string;
  data: TimeSeriesBucket[];
  dataKey: keyof TimeSeriesBucket;
  granularity: 'hour' | 'day';
}

function MiniChart({ title, color, data, dataKey, granularity }: MiniChartProps) {
  return (
    <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-4">
      <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">{title}</h4>
      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-sm text-slate-500">
          No data in this range
        </div>
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="bucket"
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={(v: string) => formatBucket(v, granularity)}
                stroke="#475569"
              />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                stroke="#475569"
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelFormatter={(v) => formatBucket(String(v ?? ''), granularity)}
                formatter={(value) => [Number(value).toLocaleString(), title]}
              />
              <Line
                type="monotone"
                dataKey={dataKey as string}
                stroke={color}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { users, updateUser, deleteUser, toggleEnabled } = useUsers();
  const { tokens, loading: tokensLoading, createToken, revokeToken, toggleToken, revealToken } =
    useUserTokens(id);
  const user = users.find((u) => u.id === id);

  const { status: quotaStatus, loading: quotaLoading, refetch: refetchQuota } = useQuota(id);
  const { status: creditStatus, loading: creditLoading, refetch: refetchCredits } = useCredits(id);
  const { overrides, createOverride, deleteOverride } = useQuotaOverrides(id);
  const {
    overrides: creditOverrides,
    createOverride: createCreditOverride,
    deleteOverride: deleteCreditOverride,
  } = useCreditOverrides(id);

  const [editOpen, setEditOpen] = useState(false);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [creditOverrideModalOpen, setCreditOverrideModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const today = startOfLocalDay(new Date());
  const [startDate, setStartDate] = useState<Date>(addDays(today, -6));
  const [endDate, setEndDate] = useState<Date>(addDays(today, 1));

  const { points, loading: chartLoading, error: chartError } = useUserTimeSeries(id, startDate, endDate);
  const granularity = pickBucket(startDate, endDate);

  const handleToggleEnabled = async () => {
    if (!user) return;
    setActionError(null);
    try {
      await toggleEnabled(user.id, !user.enabled);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to toggle');
    }
  };

  const handleDelete = async () => {
    if (!user) return;
    try {
      await deleteUser(user.id);
      navigate('/users');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete');
      setConfirmDelete(false);
    }
  };

  const totals = useMemo(() => {
    const sum = points.reduce(
      (acc, p) => {
        acc.requests += p.requests;
        acc.prompt += p.prompt_tokens;
        acc.completion += p.completion_tokens;
        acc.cacheCreation += p.cache_creation_tokens ?? 0;
        acc.cacheRead += p.cache_read_tokens ?? 0;
        acc.estimatedCredits += p.estimated_credits ?? 0;
        return acc;
      },
      { requests: 0, prompt: 0, completion: 0, cacheCreation: 0, cacheRead: 0, estimatedCredits: 0 },
    );
    const totalTokens = sum.prompt + sum.completion;
    const totalWithCache = totalTokens + sum.cacheCreation + sum.cacheRead;
    return { ...sum, totalTokens, totalWithCache };
  }, [points]);

  const applyQuickRange = (days: number) => {
    const start = addDays(startOfLocalDay(new Date()), -(days - 1));
    const end = addDays(startOfLocalDay(new Date()), 1);
    setStartDate(start);
    setEndDate(end);
  };

  const onStartChange = (value: string) => {
    const d = fromDateInput(value);
    setStartDate(d);
    if (endDate <= d) setEndDate(addDays(d, 1));
  };

  const onEndChange = (value: string) => {
    const d = fromDateInput(value);
    setEndDate(addDays(d, 1));
  };

  const numberFmt = new Intl.NumberFormat();

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/users"
          className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          &larr; Back to Users
        </Link>
      </div>

      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-slate-100">
                {user?.name ?? <span className="text-slate-500">(unknown user)</span>}
              </h2>
              {user && (
                <span
                  className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${
                    user.enabled
                      ? 'bg-green-500/15 text-green-400'
                      : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {user.enabled ? 'Enabled' : 'Disabled'}
                </span>
              )}
            </div>
            {user?.email && <p className="text-xs text-slate-400">{user.email}</p>}
            <p className="text-xs text-slate-500 font-mono">{id}</p>
            {user && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={handleToggleEnabled}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                    user.enabled
                      ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      : 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
                  }`}
                >
                  {user.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => setEditOpen(true)}
                  className="px-2.5 py-1 text-xs font-medium rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-2.5 py-1 text-xs font-medium rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  Delete
                </button>
              </div>
            )}
            {actionError && <p className="text-xs text-red-400">{actionError}</p>}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Start</label>
              <input
                type="date"
                value={toDateInput(startDate)}
                onChange={(e) => onStartChange(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">End</label>
              <input
                type="date"
                value={toDateInput(addDays(endDate, -1))}
                onChange={(e) => onEndChange(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
              />
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => applyQuickRange(1)} className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-200">Today</button>
              <button onClick={() => applyQuickRange(7)} className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-200">7d</button>
              <button onClick={() => applyQuickRange(30)} className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-200">30d</button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Requests" value={numberFmt.format(totals.requests)} loading={chartLoading} />
        <StatCard label="Input Tokens" value={numberFmt.format(totals.prompt)} loading={chartLoading} />
        <StatCard label="Output Tokens" value={numberFmt.format(totals.completion)} loading={chartLoading} />
        <StatCard label="Total Tokens" value={numberFmt.format(totals.totalTokens)} loading={chartLoading} />
        <StatCard label="Cache Creation Tokens" value={numberFmt.format(totals.cacheCreation)} loading={chartLoading} />
        <StatCard label="Cache Read Tokens" value={numberFmt.format(totals.cacheRead)} loading={chartLoading} />
        <StatCard label="Total w/ Cache" value={numberFmt.format(totals.totalWithCache)} loading={chartLoading} />
        <StatCard label="Est. MiMo Credits" value={numberFmt.format(totals.estimatedCredits)} loading={chartLoading} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <QuotaStatusCard status={quotaStatus} loading={quotaLoading} />
        <CreditStatusCard status={creditStatus} loading={creditLoading} />
      </div>

      {chartError && (
        <div className="bg-red-950/40 border border-red-900/60 rounded-lg p-4 text-sm text-red-300">
          {chartError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {chartLoading ? (
          <>
            <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-4">
              <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Requests over Time</h4>
              <Skeleton className="h-48 w-full" />
            </div>
            <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-4">
              <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Input Tokens over Time</h4>
              <Skeleton className="h-48 w-full" />
            </div>
          </>
        ) : (
          <>
            <MiniChart title="Requests over Time" color="#60a5fa" data={points} dataKey="requests" granularity={granularity} />
            <MiniChart title="Input Tokens over Time" color="#34d399" data={points} dataKey="prompt_tokens" granularity={granularity} />
          </>
        )}
      </div>

      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-200">Quota Overrides</h3>
          <button
            onClick={() => setOverrideModalOpen(true)}
            className="px-3 py-1.5 text-xs font-medium rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
          >
            + Add Override
          </button>
        </div>
        {overrides.length === 0 ? (
          <p className="text-sm text-slate-500">No overrides configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                  <th className="pb-2 pr-4">Date Range</th>
                  <th className="pb-2 pr-4">Max Tokens</th>
                  <th className="pb-2 pr-4">Note</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {overrides.map((o) => {
                  const today = new Date().toISOString().slice(0, 10);
                  const isPast = o.end_date < today;
                  return (
                    <tr key={o.id} className={isPast ? 'opacity-50' : ''}>
                      <td className="py-2 pr-4 text-slate-300">
                        {o.start_date} to {o.end_date}
                      </td>
                      <td className="py-2 pr-4 text-slate-300">{numberFmt.format(o.max_tokens)}</td>
                      <td className="py-2 pr-4 text-slate-400">{o.note || '-'}</td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => deleteOverride(o.id).then(refetchQuota)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-200">Credit Overrides</h3>
          <button
            onClick={() => setCreditOverrideModalOpen(true)}
            className="px-3 py-1.5 text-xs font-medium rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
          >
            + Add Override
          </button>
        </div>
        {creditOverrides.length === 0 ? (
          <p className="text-sm text-slate-500">No credit overrides configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                  <th className="pb-2 pr-4">Date Range</th>
                  <th className="pb-2 pr-4">Max Credits</th>
                  <th className="pb-2 pr-4">Note</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {creditOverrides.map((o) => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const isPast = o.end_date < todayStr;
                  const isActive = o.start_date <= todayStr && todayStr <= o.end_date;
                  return (
                    <tr key={o.id} className={isPast ? 'opacity-50' : ''}>
                      <td className="py-2 pr-4 text-slate-300">
                        {o.start_date} to {o.end_date}
                        {isActive && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-purple-500/15 text-purple-400">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-slate-300">{numberFmt.format(o.max_credits)}</td>
                      <td className="py-2 pr-4 text-slate-400">{o.note || '-'}</td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() =>
                            deleteCreditOverride(o.id).then(() => {
                              refetchCredits();
                            })
                          }
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TokenList
        tokens={tokens}
        loading={tokensLoading}
        onRevoke={revokeToken}
        onToggle={toggleToken}
        onReveal={revealToken}
        onCreate={() => setTokenModalOpen(true)}
      />

      <CreateTokenModal
        open={tokenModalOpen}
        onClose={() => setTokenModalOpen(false)}
        onCreate={createToken}
      />

      <EditUserModal
        open={editOpen}
        user={user ?? null}
        onClose={() => setEditOpen(false)}
        onSubmit={async (data) => {
          if (!user) return;
          await updateUser(user.id, data);
          refetchQuota();
          refetchCredits();
        }}
      />

      <QuotaOverrideModal
        open={overrideModalOpen}
        onClose={() => setOverrideModalOpen(false)}
        onCreate={async (data) => {
          await createOverride(data);
          refetchQuota();
        }}
      />

      <CreditOverrideModal
        open={creditOverrideModalOpen}
        onClose={() => setCreditOverrideModalOpen(false)}
        onCreate={async (data) => {
          await createCreditOverride(data);
          refetchCredits();
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete User"
        message={`Delete "${user?.name ?? ''}"? All tokens will also be deleted. This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
