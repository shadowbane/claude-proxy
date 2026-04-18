// Read pino JSON log files and return paginated entries, newest-first.
// Stream-based with a bounded ring buffer to avoid loading the whole file (SEC-01).
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { config } from '../config.js';

export interface FileLogEntry {
  time: string;
  level: string;
  msg: string;
  err?: { type?: string; message?: string; stack?: string };
  clientIp?: string;
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
      clientIp?: string;
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
      clientIp: typeof obj.clientIp === 'string' ? obj.clientIp : undefined,
      raw: pretty,
      timeMs,
      levelNum,
    };
  } catch {
    return { time: '', level: '', msg: line, raw: line, timeMs: null, levelNum: null };
  }
}

// Lightweight per-line filter: only parses time + level fields.
function lineMatchesFilter(
  line: string,
  startMs: number | null,
  endMs: number | null,
  wantLevelNum: number | null,
): boolean {
  if (startMs == null && endMs == null && wantLevelNum == null) return true;
  try {
    const obj = JSON.parse(line) as { time?: number | string; level?: number | string };
    let timeMs: number | null = null;
    if (typeof obj.time === 'number') timeMs = obj.time;
    else if (typeof obj.time === 'string') {
      const p = Date.parse(obj.time);
      timeMs = Number.isNaN(p) ? null : p;
    }
    let levelNum: number | null = null;
    if (typeof obj.level === 'number') levelNum = obj.level;
    else if (typeof obj.level === 'string') levelNum = LEVEL_NUMS[obj.level.toLowerCase()] ?? null;

    if (startMs != null && (timeMs == null || timeMs < startMs)) return false;
    if (endMs != null && (timeMs == null || timeMs >= endMs)) return false;
    if (wantLevelNum != null && levelNum !== wantLevelNum) return false;
    return true;
  } catch {
    // Non-JSON line — drop when filtering
    return false;
  }
}

export async function readFileLog(
  type: 'app' | 'error',
  limit: number,
  offset: number,
  filter: FileLogFilter = {},
): Promise<{ entries: FileLogEntry[]; total: number }> {
  const file = path.join(config.logDir, type === 'app' ? 'app.log' : 'error.log');

  // ENOENT → empty result (matches previous behaviour).
  try {
    await fs.access(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { entries: [], total: 0 };
    }
    throw err;
  }

  const startMs =
    filter.start && !Number.isNaN(Date.parse(filter.start)) ? Date.parse(filter.start) : null;
  const endMs =
    filter.end && !Number.isNaN(Date.parse(filter.end)) ? Date.parse(filter.end) : null;
  const wantLevelNum =
    filter.level && filter.level !== 'all' ? LEVEL_NUMS[filter.level.toLowerCase()] ?? null : null;

  // Stream forward, keep a ring buffer of the last (offset + limit) matching raw lines.
  // Memory bounded by page size, not file size.
  const capacity = Math.max(0, offset + limit);
  const ring: string[] = capacity > 0 ? new Array(capacity) : [];
  let ringStart = 0;
  let ringCount = 0;
  let total = 0;

  await new Promise<void>((resolve, reject) => {
    const reader = readline.createInterface({
      input: createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    reader.on('line', (line) => {
      if (line.trim().length === 0) return;
      if (!lineMatchesFilter(line, startMs, endMs, wantLevelNum)) return;
      total++;
      if (capacity === 0) return;
      if (ringCount < capacity) {
        ring[(ringStart + ringCount) % capacity] = line;
        ringCount++;
      } else {
        ring[ringStart] = line;
        ringStart = (ringStart + 1) % capacity;
      }
    });
    reader.on('error', reject);
    reader.on('close', resolve);
  });

  // Materialise the ring in chronological (oldest→newest) order.
  const ordered: string[] = new Array(ringCount);
  for (let i = 0; i < ringCount; i++) {
    ordered[i] = ring[(ringStart + i) % capacity]!;
  }

  // The ring holds up to (offset + limit) most-recent matches. Caller wants
  // page `[offset, offset+limit)` from the newest-first ordering, which maps
  // to the chronological slice `[ringCount - offset - limit, ringCount - offset)`.
  const sliceEnd = Math.max(0, ringCount - offset);
  const sliceStart = Math.max(0, sliceEnd - limit);
  const pageChrono = ordered.slice(sliceStart, sliceEnd);
  const pageLines = pageChrono.reverse(); // newest-first

  const entries: FileLogEntry[] = pageLines.map((line) => {
    const { timeMs: _t, levelNum: _l, ...rest } = parseLine(line);
    return rest;
  });

  return { entries, total };
}
