// Build a Fastify-compatible trustProxy value from the configured CIDR list.
// Uses node:net.BlockList so the trust set can be hot-swapped at runtime
// (e.g. when the Cloudflare IP refresh fires) without a server restart.
import { BlockList, isIPv4, isIPv6 } from 'net';

// Shorthand expansions, matching what proxy-addr supports.
const SHORTHANDS: Record<string, string[]> = {
  loopback: ['127.0.0.0/8', '::1/128'],
  linklocal: ['169.254.0.0/16', 'fe80::/10'],
  uniquelocal: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
};

let blockList = new BlockList();

function expand(entries: string[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const v = e.trim();
    if (v.length === 0) continue;
    const lower = v.toLowerCase();
    if (SHORTHANDS[lower]) out.push(...SHORTHANDS[lower]!);
    else out.push(v);
  }
  return out;
}

function buildBlockList(entries: string[]): BlockList {
  const list = new BlockList();
  for (const cidr of expand(entries)) {
    const [addr, prefixStr] = cidr.split('/');
    if (!addr) continue;
    if (prefixStr === undefined) {
      // Bare IP — treat as /32 or /128.
      if (isIPv4(addr)) list.addAddress(addr, 'ipv4');
      else if (isIPv6(addr)) list.addAddress(addr, 'ipv6');
      continue;
    }
    const prefix = parseInt(prefixStr, 10);
    if (Number.isNaN(prefix)) continue;
    if (isIPv4(addr)) list.addSubnet(addr, prefix, 'ipv4');
    else if (isIPv6(addr)) list.addSubnet(addr, prefix, 'ipv6');
  }
  return list;
}

/** Replace the trust list at runtime (used by the Cloudflare refresh loop). */
export function setTrustList(entries: string[]): void {
  blockList = buildBlockList(entries);
}

/**
 * Returns the value to pass as Fastify's `trustProxy` option.
 * - boolean / number → forwarded as-is.
 * - string[] → wrapped in a predicate over a mutable BlockList so the trust
 *   set can be swapped via setTrustList() without restarting the server.
 */
export function buildTrustProxy(
  setting: boolean | number | string[],
): boolean | number | ((addr: string, hop: number) => boolean) {
  if (typeof setting === 'boolean' || typeof setting === 'number') return setting;
  setTrustList(setting);
  return (addr: string) => {
    if (isIPv4(addr)) return blockList.check(addr, 'ipv4');
    if (isIPv6(addr)) return blockList.check(addr, 'ipv6');
    return false;
  };
}
