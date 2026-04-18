// Log file cleaner — removes old entries and enforces max file size.
// Only affects log files (app.log, error.log), not the request_logs DB table.
// Stream-based to bound memory regardless of log file size (SEC-01).
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { config } from '../config.js';
import { get } from '../db/repositories/settings.js';

const LOG_FILES = ['app.log', 'error.log'] as const;

const DEFAULTS = {
  retentionDays: 7,
  maxSizeMb: 1,
  enabled: true,
};

function getSettings() {
  const enabled = get('log_cleanup_enabled');
  const retentionDays = get('log_retention_days');
  const maxSizeMb = get('log_max_size_mb');

  return {
    enabled: enabled !== undefined ? enabled === 'true' : DEFAULTS.enabled,
    retentionDays: retentionDays !== undefined ? Math.max(1, parseInt(retentionDays, 10) || DEFAULTS.retentionDays) : DEFAULTS.retentionDays,
    maxSizeMb: maxSizeMb !== undefined ? Math.max(0.1, parseFloat(maxSizeMb) || DEFAULTS.maxSizeMb) : DEFAULTS.maxSizeMb,
  };
}

interface CleanupResult {
  file: string;
  originalSize: number;
  newSize: number;
  linesRemoved: number;
  linesKept: number;
}

export interface CleanupReport {
  ran: boolean;
  reason?: string;
  timestamp: string;
  settings: { enabled: boolean; retentionDays: number; maxSizeMb: number };
  results: CleanupResult[];
}

function shouldKeepLine(line: string, cutoff: number): boolean {
  if (line.trim().length === 0) return false;
  try {
    const obj = JSON.parse(line) as { time?: number | string };
    let ts: number | null = null;
    if (typeof obj.time === 'number') ts = obj.time;
    else if (typeof obj.time === 'string') {
      const parsed = Date.parse(obj.time);
      ts = Number.isNaN(parsed) ? null : parsed;
    }
    return ts === null || ts >= cutoff;
  } catch {
    // Not valid JSON — keep it (could be partial/startup line)
    return true;
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // best-effort
  }
}

async function cleanFile(filePath: string, retentionDays: number, maxSizeBytes: number): Promise<CleanupResult> {
  const name = path.basename(filePath);

  let originalSize: number;
  try {
    const stat = await fs.stat(filePath);
    originalSize = stat.size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { file: name, originalSize: 0, newSize: 0, linesRemoved: 0, linesKept: 0 };
    }
    throw err;
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const tmpPath = filePath + '.tmp';

  // Pass 1: filter by retention into a temp file. Track per-line byte offsets
  // so pass 2 can drop a leading prefix in one shot.
  const lineOffsets: number[] = [];
  let totalLinesSeen = 0;
  let keptLines = 0;
  let writtenBytes = 0;

  try {
    const writer = createWriteStream(tmpPath, { encoding: 'utf8' });
    try {
      const reader = readline.createInterface({
        input: createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });
      // Async iteration naturally backpressures the underlying stream and avoids
      // stacking 'drain' listeners on the writer (the prior pause/resume pattern
      // tripped MaxListenersExceededWarning under load).
      for await (const line of reader) {
        totalLinesSeen++;
        if (line.trim().length === 0) continue;
        if (!shouldKeepLine(line, cutoff)) continue;
        lineOffsets.push(writtenBytes);
        const out = line + '\n';
        writtenBytes += Buffer.byteLength(out, 'utf8');
        keptLines++;
        if (!writer.write(out)) {
          await new Promise<void>((resolve) => writer.once('drain', resolve));
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        writer.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });
    }

    let finalPath = tmpPath;
    let finalSize = writtenBytes;
    let finalKept = keptLines;
    let tmp2Path: string | null = null;

    // Pass 2: enforce max size. Drop oldest lines (front of file) until we fit.
    if (writtenBytes > maxSizeBytes && lineOffsets.length > 0) {
      // Find first line whose tail (writtenBytes - offset) fits within the budget,
      // keeping at least one line.
      let dropIndex = 0;
      for (let i = 0; i < lineOffsets.length; i++) {
        const tail = writtenBytes - lineOffsets[i]!;
        if (tail <= maxSizeBytes) {
          dropIndex = i;
          break;
        }
        dropIndex = i + 1;
      }
      // Always keep at least one line if any survived retention.
      if (dropIndex >= lineOffsets.length) dropIndex = lineOffsets.length - 1;

      if (dropIndex > 0) {
        const skipBytes = lineOffsets[dropIndex]!;
        tmp2Path = filePath + '.tmp2';
        await new Promise<void>((resolve, reject) => {
          const input = createReadStream(tmpPath, { start: skipBytes, encoding: 'utf8' });
          const out = createWriteStream(tmp2Path!, { encoding: 'utf8' });
          input.on('error', reject);
          out.on('error', reject);
          out.on('finish', resolve);
          input.pipe(out);
        });
        finalPath = tmp2Path;
        finalSize = writtenBytes - skipBytes;
        finalKept = lineOffsets.length - dropIndex;
      }
    }

    // Only replace the original if size changed.
    if (finalSize !== originalSize) {
      await fs.rename(finalPath, filePath);
      // Clean up the other temp if we used both
      if (tmp2Path && finalPath === tmp2Path) {
        await safeUnlink(tmpPath);
      }
    } else {
      await safeUnlink(tmpPath);
      if (tmp2Path) await safeUnlink(tmp2Path);
    }

    const linesRemoved = totalLinesSeen - finalKept;
    return { file: name, originalSize, newSize: finalSize, linesRemoved, linesKept: finalKept };
  } catch (err) {
    await safeUnlink(tmpPath);
    await safeUnlink(filePath + '.tmp2');
    throw err;
  }
}

export async function runLogCleanup(force = false): Promise<CleanupReport> {
  const settings = getSettings();
  const timestamp = new Date().toISOString();

  if (!settings.enabled && !force) {
    return { ran: false, reason: 'Log cleanup is disabled', timestamp, settings, results: [] };
  }

  const maxSizeBytes = settings.maxSizeMb * 1024 * 1024;
  const results: CleanupResult[] = [];

  for (const file of LOG_FILES) {
    const filePath = path.join(config.logDir, file);
    const result = await cleanFile(filePath, settings.retentionDays, maxSizeBytes);
    results.push(result);
  }

  return { ran: true, timestamp, settings, results };
}

// Schedule periodic cleanup — runs every hour
let intervalId: ReturnType<typeof setInterval> | null = null;

export function startLogCleanupSchedule(logger: { info: (msg: string) => void; error: (obj: unknown, msg: string) => void }) {
  // Run once on startup (delayed 10s to let server finish booting)
  setTimeout(async () => {
    try {
      const report = await runLogCleanup();
      if (report.ran) {
        const totalRemoved = report.results.reduce((sum, r) => sum + r.linesRemoved, 0);
        if (totalRemoved > 0) {
          logger.info(`Log cleanup: removed ${totalRemoved} old entries`);
        }
      }
    } catch (err) {
      logger.error(err, 'Log cleanup failed on startup');
    }
  }, 10_000);

  // Then run every hour
  intervalId = setInterval(async () => {
    try {
      const report = await runLogCleanup();
      if (report.ran) {
        const totalRemoved = report.results.reduce((sum, r) => sum + r.linesRemoved, 0);
        if (totalRemoved > 0) {
          logger.info(`Log cleanup: removed ${totalRemoved} old entries`);
        }
      }
    } catch (err) {
      logger.error(err, 'Scheduled log cleanup failed');
    }
  }, 60 * 60 * 1000);
}

export function stopLogCleanupSchedule() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
