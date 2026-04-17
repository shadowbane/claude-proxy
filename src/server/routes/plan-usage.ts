// Plan-usage route — Anthropic-compatible /api/oauth/usage for the claude-statusline skill.
import type { FastifyPluginAsync } from 'fastify';
import { proxyAuth } from '../middleware/proxy-auth.js';
import { getQuotaStatus } from '../db/repositories/quota.js';
import { getDailyLeaderboardPosition } from '../db/repositories/request-log.js';

// SQLite stores datetimes as "YYYY-MM-DD HH:MM:SS" in UTC. The statusline parses
// up to %Y-%m-%dT%H:%M:%S and requires an explicit +00:00 offset.
function toRfc3339Utc(sqliteDt: string): string {
  return `${sqliteDt.replace(' ', 'T')}+00:00`;
}

export const planUsageRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/oauth/usage',
    { preHandler: proxyAuth },
    async (request) => {
      const { userId } = request.proxyAuth!;
      const quota = getQuotaStatus(userId);
      const leaderboard = getDailyLeaderboardPosition(userId, quota.window_start);

      const hasLimit = quota.quota_limit !== null && quota.quota_limit > 0;
      const five_hour = hasLimit
        ? {
            utilization: Math.round(
              Math.min(100, (quota.tokens_used / (quota.quota_limit as number)) * 100) * 10,
            ) / 10,
            resets_at: toRfc3339Utc(quota.window_end),
          }
        : { utilization: null, resets_at: null };

      return {
        five_hour,
        seven_day: { utilization: null, resets_at: null },
        leaderboard,
      };
    },
  );
};
