// Read pino JSON log files and return paginated entries, newest-first.
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

export interface FileLogEntry {
  time: string;
  level: string;
  msg: string;
  err?: { type?: string; message?: string; stack?: string };
  raw: string;
}

const LEVEL_NAMES: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

const LEVEL_NUMS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface FileLogFilter {
  start?: string;
  end?: string;
  level?: string;
}

interface ParsedEntry extends FileLogEntry {
  timeMs: number | null;
  levelNum: number | null;
}

function parseLine(line: string): ParsedEntry {
  try {
    const obj = JSON.parse(line) as {
      time?: number | string;
      level?: number | string;
      msg?: string;
      message?: string;
      err?: { type?: string; message?: string; stack?: string };
    };
    let timeMs: number | null = null;
    let timeStr = '';
    if (typeof obj.time === 'number') {
      timeMs = obj.time;
      timeStr = new Date(obj.time).toISOString();
    } else if (typeof obj.time === 'string') {
      timeStr = obj.time;
      const parsed = Date.parse(obj.time);
      timeMs = Number.isNaN(parsed) ? null : parsed;
    }
    let levelNum: number | null = null;
    let levelStr = '';
    if (typeof obj.level === 'number') {
      levelNum = obj.level;
      levelStr = LEVEL_NAMES[obj.level] ?? String(obj.level);
    } else if (typeof obj.level === 'string') {
      levelStr = obj.level;
      levelNum = LEVEL_NUMS[obj.level.toLowerCase()] ?? null;
    }
    const err =
      obj.err && typeof obj.err === 'object'
        ? { type: obj.err.type, message: obj.err.message, stack: obj.err.stack }
        : undefined;
    let pretty = line;
    try {
      pretty = JSON.stringify(obj, null, 2);
    } catch {
      // keep original line
    }
    return {
      time: timeStr,
      level: levelStr,
      msg: obj.msg ?? obj.message ?? '',
      err,
      raw: pretty,
      timeMs,
      levelNum,
    };
  } catch {
    return { time: '', level: '', msg: line, raw: line, timeMs: null, levelNum: null };
  }
}

export async function readFileLog(
  type: 'app' | 'error',
  limit: number,
  offset: number,
  filter: FileLogFilter = {},
): Promise<{ entries: FileLogEntry[]; total: number }> {
  const file = path.join(config.logDir, type === 'app' ? 'app.log' : 'error.log');

  let content: string;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { entries: [], total: 0 };
    }
    throw err;
  }

  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  const startMs =
    filter.start && !Number.isNaN(Date.parse(filter.start)) ? Date.parse(filter.start) : null;
  const endMs =
    filter.end && !Number.isNaN(Date.parse(filter.end)) ? Date.parse(filter.end) : null;
  const wantLevelNum =
    filter.level && filter.level !== 'all' ? LEVEL_NUMS[filter.level.toLowerCase()] : null;

  // Parse newest-first, then filter, then paginate.
  const parsed: ParsedEntry[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseLine(lines[i]);
    if (startMs != null && (entry.timeMs == null || entry.timeMs < startMs)) continue;
    if (endMs != null && (entry.timeMs == null || entry.timeMs >= endMs)) continue;
    if (wantLevelNum != null && entry.levelNum !== wantLevelNum) continue;
    parsed.push(entry);
  }

  const total = parsed.length;
  const slice = parsed.slice(offset, offset + limit);
  const entries: FileLogEntry[] = slice.map(({ timeMs: _t, levelNum: _l, ...rest }) => rest);

  return { entries, total };
}
