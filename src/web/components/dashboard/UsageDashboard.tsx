import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUsage } from '@/hooks/useUsage.js';
import { useTimeSeries, pickBucket } from '@/hooks/useTimeSeries.js';
import { useUsers } from '@/hooks/useUsers.js';
import { addDays, startOfLocalDay } from '@/lib/date-range.js';
import { DateRangeBar } from '../shared/DateRangeBar.js';
import { StatCard } from './StatCard.js';
import { UsageChart } from './UsageChart.js';
import { Skeleton } from '../shared/Skeleton.js';

function formatDate(value: string | null): string {
  if (!value) return 'never';
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function copy(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

export function UsageDashboard() {
  const today = startOfLocalDay(new Date());
  const [startDate, setStartDate] = useState<Date>(addDays(today, -6));
  const [endDate, setEndDate] = useState<Date>(addDays(today, 1));
  const navigate = useNavigate();

  const { stats, byUser, loading, error } = useUsage(startDate, endDate);
  const { points, loading: chartLoading } = useTimeSeries(startDate, endDate);
  const { users } = useUsers();
  const granularity = pickBucket(startDate, endDate);

  const numberFmt = new Intl.NumberFormat();
  const totalRequests = stats?.total ?? 0;
  const enabledUsers = users.filter((u) => u.enabled).length;

  const proxyOrigin = window.location.origin;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Endpoints */}
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-5 space-y-3">
        <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide">Endpoints</h3>
        <div className="space-y-2">
          {[
            { label: 'Claude Code', path: '', suffix: ' (set ANTHROPIC_BASE_URL to this)' },
            { label: 'Messages', path: '/v1/messages' },
          ].map(({ label, path, suffix }) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-28 shrink-0">{label}</span>
              <code className="flex-1 bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-blue-400 select-all">
                {proxyOrigin}{path}
                {suffix && <span className="text-slate-500">{suffix}</span>}
              </code>
              <button
                onClick={() => copy(`${proxyOrigin}${path}`)}
                className="px-2.5 py-2 bg-slate-700 hover:bg-slate-600 rounded-md transition-colors text-slate-300 text-xs"
              >
                Copy
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Date range */}
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-5">
        <DateRangeBar
          startDate={startDate}
          endDate={endDate}
          setStartDate={setStartDate}
          setEndDate={setEndDate}
        />
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800/60 text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Users" value={String(enabledUsers)} />
        <StatCard label="Total Input Tokens" value={numberFmt.format(stats?.promptTokens ?? 0)} loading={loading} />
        <StatCard label="Total Output Tokens" value={numberFmt.format(stats?.completionTokens ?? 0)} loading={loading} />
        <StatCard label="Total Tokens" value={numberFmt.format(stats?.totalTokens ?? 0)} loading={loading} />
        <StatCard label="Cache Creation Tokens" value={numberFmt.format(stats?.cacheCreationTokens ?? 0)} loading={loading} />
        <StatCard label="Cache Read Tokens" value={numberFmt.format(stats?.cacheReadTokens ?? 0)} loading={loading} />
        <StatCard label="Total w/ Cache" value={numberFmt.format(stats?.totalWithCache ?? 0)} loading={loading} />
        <StatCard label="Est. MiMo Credits" value={numberFmt.format(stats?.estimatedCredits ?? 0)} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <UsageChart
          title="Requests over Time"
          data={points}
          lines={[{ dataKey: 'requests', color: '#60a5fa', label: 'Requests' }]}
          granularity={granularity}
          loading={chartLoading}
        />
        <UsageChart
          title="Tokens over Time"
          data={points}
          lines={[
            { dataKey: 'prompt_tokens', color: '#34d399', label: 'Input' },
            { dataKey: 'completion_tokens', color: '#f59e0b', label: 'Output' },
          ]}
          granularity={granularity}
          loading={chartLoading}
        />
      </div>

      {/* Usage by User table */}
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/60">
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Token Usage by User
          </h3>
        </div>
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/60 text-slate-400">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">User</th>
                  <th className="text-right px-4 py-2.5 font-medium">Requests</th>
                  <th className="text-right px-4 py-2.5 font-medium">Percentage (%)</th>
                  <th className="text-right px-4 py-2.5 font-medium">Input</th>
                  <th className="text-right px-4 py-2.5 font-medium">Output</th>
                  <th className="text-right px-4 py-2.5 font-medium">Total</th>
                  <th className="text-right px-4 py-2.5 font-medium">Last Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2.5"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-4 py-2.5"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-4 py-2.5"><Skeleton className="h-4 w-12 ml-auto" /></td>
                    <td className="px-4 py-2.5"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-4 py-2.5"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-4 py-2.5"><Skeleton className="h-4 w-20 ml-auto" /></td>
                    <td className="px-4 py-2.5"><Skeleton className="h-4 w-24 ml-auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : byUser.length === 0 ? (
          <div className="px-4 py-6 text-center text-slate-500 text-sm">
            No usage data in this range
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/60 text-slate-400">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">User</th>
                  <th className="text-right px-4 py-2.5 font-medium">Requests</th>
                  <th className="text-right px-4 py-2.5 font-medium">Percentage (%)</th>
                  <th className="text-right px-4 py-2.5 font-medium">Input</th>
                  <th className="text-right px-4 py-2.5 font-medium">Output</th>
                  <th className="text-right px-4 py-2.5 font-medium">Total</th>
                  <th className="text-right px-4 py-2.5 font-medium">Last Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {byUser.map((row) => {
                  const pct = totalRequests > 0
                    ? ((row.total_requests / totalRequests) * 100).toFixed(2)
                    : '0.00';
                  const errPct = totalRequests > 0 && row.errors > 0
                    ? ((row.errors / totalRequests) * 100).toFixed(2)
                    : null;
                  return (
                    <tr
                      key={row.user_id}
                      className="hover:bg-slate-800/60 cursor-pointer"
                      onClick={() => navigate(`/users/${row.user_id}`)}
                    >
                      <td className="px-4 py-2.5">
                        <div className="text-slate-200 font-medium">{row.user_name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{row.user_id}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-300 font-mono">
                        {numberFmt.format(row.total_requests)}
                        {row.errors > 0 && (
                          <span className="text-red-400 ml-1">
                            ({row.errors} err)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-300 font-mono">
                        {pct}%
                        {errPct && (
                          <span className="text-red-400 ml-1">
                            ({errPct}% err)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-300 font-mono">
                        {numberFmt.format(row.prompt_tokens)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-300 font-mono">
                        {numberFmt.format(row.completion_tokens)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-100 font-mono font-bold">
                        {numberFmt.format(row.total_tokens)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-500 text-xs whitespace-nowrap">
                        {formatDate(row.last_used_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
