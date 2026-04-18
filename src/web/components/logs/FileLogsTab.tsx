import { Fragment, useState } from 'react';
import { useFileLogs, type FileLogType } from '@/hooks/useFileLogs.js';
import { addDays, startOfLocalDay } from '@/lib/date-range.js';
import { DateRangeBar } from '../shared/DateRangeBar.js';
import { Pagination } from './Pagination.js';
import { Skeleton } from '../shared/Skeleton.js';

function formatTime(value: string): string {
  if (!value) return '\u2014';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function levelClass(level: string): string {
  switch (level) {
    case 'error':
    case 'fatal':
      return 'text-red-400';
    case 'warn':
      return 'text-yellow-400';
    case 'info':
      return 'text-blue-400';
    case 'debug':
      return 'text-slate-400';
    case 'trace':
      return 'text-slate-500';
    default:
      return 'text-slate-400';
  }
}

export function FileLogsTab({ type }: { type: FileLogType }) {
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const today = startOfLocalDay(new Date());
  const [startDate, setStartDate] = useState<Date>(today);
  const [endDate, setEndDate] = useState<Date>(addDays(today, 1));
  const [level, setLevel] = useState<string>('all');
  const offset = (page - 1) * pageSize;
  const { entries, total, loading, error } = useFileLogs(
    type,
    pageSize,
    offset,
    startDate,
    endDate,
    type === 'app' ? level : undefined,
  );

  const resetPage = () => setPage(1);

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-4">
        <DateRangeBar
          startDate={startDate}
          endDate={endDate}
          setStartDate={(d) => {
            setStartDate(d);
            resetPage();
          }}
          setEndDate={(d) => {
            setEndDate(d);
            resetPage();
          }}
        >
          {type === 'app' && (
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                Level
              </label>
              <select
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value);
                  resetPage();
                }}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
              >
                <option value="all">All</option>
                <option value="trace">Trace</option>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
                <option value="fatal">Fatal</option>
              </select>
            </div>
          )}
        </DateRangeBar>
      </div>
      <div className="bg-slate-800 border border-slate-700/60 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs table-fixed">
          <thead className="bg-slate-900/60 text-slate-400">
            <tr>
              <th className="w-6 px-2 py-2"></th>
              <th className="text-left px-3 py-2 font-medium w-48 whitespace-nowrap">Time</th>
              <th className="text-left px-3 py-2 font-medium w-20">Level</th>
              <th className="text-left px-3 py-2 font-medium">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/60">
            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  <td className="px-2 py-1.5"><Skeleton className="h-3 w-3 mx-auto" /></td>
                  <td className="px-3 py-1.5"><Skeleton className="h-3 w-32" /></td>
                  <td className="px-3 py-1.5"><Skeleton className="h-3 w-12" /></td>
                  <td className="px-3 py-1.5"><Skeleton className="h-3 w-full max-w-md" /></td>
                </tr>
              ))}
            {!loading && error && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-red-400">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  No log entries
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              entries.map((entry, i) => {
                const isOpen = expanded.has(i);
                const errMsg = entry.err?.message;
                return (
                  <Fragment key={`${page}-${i}`}>
                    <tr
                      onClick={() => toggle(i)}
                      className="hover:bg-slate-800/60 align-top cursor-pointer"
                    >
                      <td className="px-2 py-1.5 text-slate-500 select-none text-center">
                        {isOpen ? '\u25BE' : '\u25B8'}
                      </td>
                      <td className="px-3 py-1.5 text-slate-500 font-mono whitespace-nowrap">
                        {formatTime(entry.time)}
                      </td>
                      <td className={`px-3 py-1.5 font-mono uppercase ${levelClass(entry.level)}`}>
                        {entry.level || '\u2014'}
                      </td>
                      <td className="px-3 py-1.5 text-slate-300 font-mono break-all">
                        <div>{entry.msg || entry.raw}</div>
                        {errMsg && (
                          <div className="mt-0.5 text-red-400/90 break-all">
                            {entry.err?.type ? `${entry.err.type}: ` : ''}
                            {errMsg}
                          </div>
                        )}
                        {entry.clientIp && (
                          <div className="mt-0.5">
                            <span className="inline-block text-[10px] uppercase tracking-wide text-slate-400 bg-slate-900/80 border border-slate-700/60 rounded px-1.5 py-0.5">
                              ip {entry.clientIp}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-900/60">
                        <td></td>
                        <td colSpan={3} className="px-3 py-3">
                          {entry.err?.stack && (
                            <div className="mb-3">
                              <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                                Stack
                              </div>
                              <pre className="text-[11px] font-mono text-red-300/90 whitespace-pre-wrap break-all bg-slate-950/60 border border-slate-700/60 rounded p-2">
                                {entry.err.stack}
                              </pre>
                            </div>
                          )}
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                              Raw
                            </div>
                            <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all bg-slate-950/60 border border-slate-700/60 rounded p-2">
                              {entry.raw}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(p) => {
          setPage(p);
          setExpanded(new Set());
        }}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
          setExpanded(new Set());
        }}
      />
      </div>
    </div>
  );
}
