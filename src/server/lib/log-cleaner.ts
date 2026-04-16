// Log file cleaner — removes old entries and enforces max file size.
// Only affects log files (app.log, error.log), not the request_logs DB table.
import fs from 'fs/promises';
import path from 'path';
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

async function cleanFile(filePath: string, retentionDays: number, maxSizeBytes: number): Promise<CleanupResult> {
  const name = path.basename(filePath);
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { file: name, originalSize: 0, newSize: 0, linesRemoved: 0, linesKept: 0 };
    }
    throw err;
  }

  const originalSize = Buffer.byteLength(content, 'utf8');
  const lines = content.split('\n');
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  // Step 1: Remove entries older than retention period
  const kept: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    try {
      const obj = JSON.parse(line) as { time?: number | string };
      let ts: number | null = null;
      if (typeof obj.time === 'number') ts = obj.time;
      else if (typeof obj.time === 'string') {
        const parsed = Date.parse(obj.time);
        ts = Number.isNaN(parsed) ? null : parsed;
      }
      // Keep if we can't parse the timestamp (safe default) or if it's within retention
      if (ts === null || ts >= cutoff) {
        kept.push(line);
      }
    } catch {
      // Not valid JSON — keep it (could be partial/startup line)
      kept.push(line);
    }
  }

  // Step 2: Enforce max size — trim oldest entries (from the front) if too large
  let result = kept;
  let joined = result.join('\n') + (result.length > 0 ? '\n' : '');
  let currentSize = Buffer.byteLength(joined, 'utf8');

  if (currentSize > maxSizeBytes && result.length > 0) {
    // Remove lines from the front (oldest) until we fit
    while (currentSize > maxSizeBytes && result.length > 1) {
      result.shift();
      joined = result.join('\n') + '\n';
      currentSize = Buffer.byteLength(joined, 'utf8');
    }
  }

  const linesRemoved = lines.filter((l) => l.trim().length > 0).length - result.length;
  const newContent = result.length > 0 ? result.join('\n') + '\n' : '';
  const newSize = Buffer.byteLength(newContent, 'utf8');

  // Only write if something changed
  if (newSize !== originalSize) {
    await fs.writeFile(filePath, newContent, 'utf8');
  }

  return { file: name, originalSize, newSize, linesRemoved, linesKept: result.length };
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
