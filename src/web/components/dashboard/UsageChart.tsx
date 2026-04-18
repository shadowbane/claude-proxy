import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TimeSeriesBucket } from '@shared/types';
import { Skeleton } from '../shared/Skeleton.js';

function formatBucket(bucket: string, granularity: 'hour' | 'day'): string {
  const parsed = new Date(bucket.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return bucket;
  if (granularity === 'hour') {
    return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return parsed.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
}

interface UsageChartProps {
  title: string;
  data: TimeSeriesBucket[];
  lines: { dataKey: keyof TimeSeriesBucket; color: string; label: string }[];
  granularity: 'hour' | 'day';
  loading?: boolean;
}

export function UsageChart({ title, data, lines, granularity, loading = false }: UsageChartProps) {
  return (
    <div className="bg-slate-800 border border-slate-700/60 rounded-lg p-4">
      <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">{title}</h4>
      {loading ? (
        <Skeleton className="h-56 w-full" />
      ) : data.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-sm text-slate-500">
          No data in this range
        </div>
      ) : (
        <div className="h-56">
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
                formatter={(value) => [Number(value).toLocaleString()]}
              />
              {lines.map(({ dataKey, color, label }) => (
                <Line
                  key={dataKey}
                  type="monotone"
                  dataKey={dataKey as string}
                  name={label}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
