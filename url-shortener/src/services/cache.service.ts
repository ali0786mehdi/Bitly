import { redis } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const KEY_PREFIX = 'url:';

function keyFor(shortCode: string): string {
  return `${KEY_PREFIX}${shortCode}`;
}

/**
 * Cache-aside read: check Redis first, return null on miss.
 * The caller is responsible for falling through to the DB and then
 * calling `set()` to populate the cache (see shortener.service.ts).
 */
export async function get(shortCode: string): Promise<string | null> {
  try {
    return await redis.get(keyFor(shortCode));
  } catch (err) {
    // Redis being down should degrade to "cache miss", not take down
    // the redirect path. The DB is still the source of truth.
    logger.error({ err, shortCode }, 'Redis GET failed, falling back to DB');
    return null;
  }
}

export async function set(shortCode: string, longUrl: string, ttlSeconds = env.cacheTtlSeconds): Promise<void> {
  try {
    await redis.set(keyFor(shortCode), longUrl, 'EX', ttlSeconds);
  } catch (err) {
    logger.error({ err, shortCode }, 'Redis SET failed — write proceeds, cache just stays cold');
  }
}

/**
 * Invalidation: called whenever a URL is deactivated, updated, or deleted,
 * so stale entries never get served after the source of truth changes.
 */
export async function invalidate(shortCode: string): Promise<void> {
  try {
    await redis.del(keyFor(shortCode));
  } catch (err) {
    logger.error({ err, shortCode }, 'Redis DEL failed during invalidation');
  }
}

/**
 * Write-through variant: used on URL creation so the very first redirect
 * is already a cache hit instead of paying for one guaranteed miss.
 */
export async function writeThrough(shortCode: string, longUrl: string): Promise<void> {
  await set(shortCode, longUrl);
}
