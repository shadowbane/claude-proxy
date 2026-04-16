import type { ReactNode } from 'react';
import { addDays, fromDateInput, startOfLocalDay, toDateInput } from '@/lib/date-range.js';

interface DateRangeBarProps {
  startDate: Date;
  endDate: Date;
  setStartDate: (d: Date) => void;
  setEndDate: (d: Date) => void;
  children?: ReactNode;
}

export function DateRangeBar({
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  children,
}: DateRangeBarProps) {
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

  return (
    <div className="flex flex-wrap items-end gap-3 justify-end">
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
        <button
          onClick={() => applyQuickRange(1)}
          className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-200"
        >
          Today
        </button>
        <button
          onClick={() => applyQuickRange(7)}
          className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-200"
        >
          7d
        </button>
        <button
          onClick={() => applyQuickRange(30)}
          className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-200"
        >
          30d
        </button>
      </div>
      {children}
    </div>
  );
}
