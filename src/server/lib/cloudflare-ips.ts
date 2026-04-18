// Fetch and cache Cloudflare's published IP CIDR lists.
// Used to populate Fastify's trustProxy when the server is exposed directly to Cloudflare.
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

const V4_URL = 'https://www.cloudflare.com/ips-v4';
const V6_URL = 'https://www.cloudflare.com/ips-v6';
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FETCH_TIMEOUT_MS = 5_000;
const CIDR_PATTERN = /^[0-9a-fA-F.:]+\/\d{1,3}$/;

interface CacheFile {
  fetchedAt: number;
  v4: string[];
  v6: string[];
}

function cachePath(): string {
  // logDir is typically ./data/logs — store the cache one level up alongside the DB.
  return path.join(config.logDir, '..', 'cloudflare-ips.json');
}

async function readCache(): Promise<CacheFile | null> {
  try {
    const raw = await fs.readFile(cachePath(), 'utf8');
    const parsed = JSON.parse(raw) as CacheFile;
    if (
      typeof parsed.fetchedAt === 'number' &&
      Array.isArray(parsed.v4) &&
      Array.isArray(parsed.v6)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeCache(data: CacheFile): Promise<void> {
  const target = cachePath();
  const tmp = target + '.tmp';
  await fs.mkdir(path.dirname(target), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(tmp, { encoding: 'utf8' });
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(JSON.stringify(data, null, 2));
  });
  await fs.rename(tmp, target);
}

async function fetchList(url: string): Promise<string[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Cloudflare ${url} → HTTP ${res.status}`);
  const text = await res.text();
  const cidrs = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && CIDR_PATTERN.test(l));
  if (cidrs.length === 0) throw new Error(`Cloudflare ${url} returned no valid CIDRs`);
  return cidrs;
}

export interface CloudflareLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (obj: unknown, msg: string) => void;
}

/**
 * Returns merged v4+v6 Cloudflare CIDRs, fetching fresh if cache is missing or
 * older than 7 days. On network failure, falls back to a stale cache when
 * available; otherwise returns an empty list so startup can still proceed.
 */
export async function loadCloudflareCidrs(logger?: CloudflareLogger): Promise<string[]> {
  const cached = await readCache();
  const fresh = cached && Date.now() - cached.fetchedAt < REFRESH_INTERVAL_MS;
  if (cached && fresh) {
    return [...cached.v4, ...cached.v6];
  }

  try {
    const [v4, v6] = await Promise.all([fetchList(V4_URL), fetchList(V6_URL)]);
    const data: CacheFile = { fetchedAt: Date.now(), v4, v6 };
    await writeCache(data);
    logger?.info(`Cloudflare IPs refreshed: ${v4.length} v4 + ${v6.length} v6`);
    return [...v4, ...v6];
  } catch (err) {
    if (cached) {
      logger?.warn(
        `Cloudflare IP refresh failed (${(err as Error).message}); using stale cache from ${new Date(cached.fetchedAt).toISOString()}`,
      );
      return [...cached.v4, ...cached.v6];
    }
    logger?.error(err, 'Cloudflare IP fetch failed and no cache available');
    return [];
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Starts a 7-day refresh loop. The provided onRefresh callback receives the new
 * CIDR list so the caller can hot-swap its trust list without a restart.
 */
export function startCloudflareRefreshSchedule(
  logger: CloudflareLogger,
  onRefresh: (cidrs: string[]) => void,
): void {
  intervalId = setInterval(async () => {
    try {
      const cidrs = await loadCloudflareCidrs(logger);
      onRefresh(cidrs);
    } catch (err) {
      logger.error(err, 'Scheduled Cloudflare IP refresh failed');
    }
  }, REFRESH_INTERVAL_MS);
}

export function stopCloudflareRefreshSchedule(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
