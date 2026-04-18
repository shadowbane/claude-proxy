import { useState } from 'react';
import { useRequestLogs } from '@/hooks/useRequestLogs.js';
import { useUsers } from '@/hooks/useUsers.js';
import { addDays, startOfLocalDay } from '@/lib/date-range.js';
import { DateRangeBar } from '../shared/DateRangeBar.js';
import { Pagination } from './Pagination.js';
import { Skeleton } from '../shared/Skeleton.js';

function formatDateTime(value: string): string {
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function RequestLogsTab() {
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const today = startOfLocalDay(new Date());
  const [startDate, setStartDate] = useState<Date>(today);
  const [endDate, setEndDate] = useState<Date>(addDays(today, 1));
  const [filterUser, setFilterUser] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const offset = (page - 1) * pageSize;

  const { users } = useUsers();
  const { logs, total, loading, error } = useRequestLogs(
    pageSize,
    offset,
    startDate,
    endDate,
    filterUser || undefined,
    filterStatus || undefined,
  );

  const handleStartChange = (d: Date) => {
    setStartDate(d);
    setPage(1);
  };
  const handleEndChange = (d: Date) => {
    setEndDate(d);
    setPage(1);
  };

  const userMap = new Map(users.map((u) => [u.id, u.name]));

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-4">
        <DateRangeBar
          startDate={startDate}
          endDate={endDate}
          setStartDate={handleStartChange}
          setEndDate={handleEndChange}
        >
          <select
            value={filterUser}
            onChange={(e) => { setFilterUser(e.target.value); setPage(1); }}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
          >
            <option value="">All Users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
          >
            <option value="">All Status</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
          </select>
        </DateRangeBar>
      </div>

      <div className="bg-slate-800 border border-slate-700/60 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-900/60 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Time</th>
                <th className="text-left px-3 py-2 font-medium">IP Addr</th>
                <th className="text-left px-3 py-2 font-medium">User</th>
                <th className="text-left px-3 py-2 font-medium">Model</th>
                <th className="text-right px-3 py-2 font-medium">Input</th>
                <th className="text-right px-3 py-2 font-medium">Output</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/60">
              {loading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`sk-${i}`}>
                    <td className="px-3 py-1.5"><Skeleton className="h-3 w-32" /></td>
                    <td className="px-3 py-1.5"><Skeleton className="h-3 w-24" /></td>
                    <td className="px-3 py-1.5"><Skeleton className="h-3 w-24" /></td>
                    <td className="px-3 py-1.5"><Skeleton className="h-3 w-28" /></td>
                    <td className="px-3 py-1.5"><Skeleton className="h-3 w-14 ml-auto" /></td>
                    <td className="px-3 py-1.5"><Skeleton className="h-3 w-14 ml-auto" /></td>
                    <td className="px-3 py-1.5"><Skeleton className="h-3 w-16" /></td>
                    <td className="px-3 py-1.5"><Skeleton className="h-3 w-12 ml-auto" /></td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-red-400">{error}</td>
                </tr>
              )}
              {!loading && !error && logs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">No requests yet</td>
                </tr>
              )}
              {!loading &&
                !error &&
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/60">
                    <td className="px-3 py-1.5 text-slate-500 font-mono whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="px-3 py-1.5 text-slate-300">
                      {log.client_ip }
                    </td>
                    <td className="px-3 py-1.5 text-slate-300">
                      {log.user_id ? userMap.get(log.user_id) ?? log.user_id.slice(0, 8) : '\u2014'}
                    </td>
                    <td className="px-3 py-1.5 text-slate-300 font-mono">{log.model}</td>
                    <td className="px-3 py-1.5 text-right text-slate-400 font-mono">
                      {log.prompt_tokens.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-400 font-mono">
                      {log.completion_tokens.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 max-w-[320px]">
                      <span className={log.status === 'success' ? 'text-green-400' : 'text-red-400'}>
                        {log.status}
                      </span>
                      {log.error_message && (
                        <span
                          className="ml-2 text-[11px] text-red-400/70 inline-block align-middle max-w-[240px] truncate"
                          title={log.error_message}
                        >
                          {log.error_message}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-400 font-mono whitespace-nowrap">
                      {log.latency_ms != null ? `${log.latency_ms}ms` : '\u2014'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
}
