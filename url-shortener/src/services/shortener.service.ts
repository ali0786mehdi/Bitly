import { env } from '../config/env';
import { generateShortCode, isValidShortCode } from '../utils/base62';
import * as UrlModel from '../models/url.model';
import * as Cache from './cache.service';
import { logger } from '../utils/logger';

export class InvalidUrlError extends Error {}
export class ShortCodeCollisionError extends Error {}

const URL_PATTERN = /^https?:\/\/.+/i;
const MAX_GENERATION_ATTEMPTS = 5;

function assertValidLongUrl(longUrl: string): void {
  if (!URL_PATTERN.test(longUrl)) {
    throw new InvalidUrlError('long_url must be a valid http(s) URL');
  }
}

/**
 * Creates a short URL. Retries on the rare collision (birthday-bound
 * probability at length 7 / 62 chars is astronomically low, but the code
 * handles it correctly rather than assuming it away) using an
 * INSERT ... ON CONFLICT check at the DB level as the final authority —
 * the DB's PRIMARY KEY constraint is what actually guarantees uniqueness,
 * this loop just avoids surfacing a 500 on the rare collision.
 */
export async function createShortUrl(
  longUrl: string,
  userId: string | null = null,
  expiresAt: Date | null = null
): Promise<UrlModel.UrlRecord> {
  assertValidLongUrl(longUrl);

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const shortCode = generateShortCode(env.shortCodeLength);
    try {
      const record = await UrlModel.insertUrl(shortCode, longUrl, userId, expiresAt);
      // Write-through: populate the cache immediately so the first
      // redirect is a hit, not a guaranteed miss. Use record.short_code
      // (not the local `shortCode` var) so the cache key always matches
      // what was actually persisted, even if a DB trigger or default were
      // ever to change it.
      await Cache.writeThrough(record.short_code, record.long_url);
      return record;
    } catch (err: any) {
      if (err.code === '23505') {
        // Postgres unique_violation on the primary key — collision, retry.
        logger.warn({ shortCode }, 'Short code collision, regenerating');
        continue;
      }
      throw err;
    }
  }

  throw new ShortCodeCollisionError(
    `Failed to generate a unique short code after ${MAX_GENERATION_ATTEMPTS} attempts`
  );
}

/**
 * Cache-aside redirect lookup — the hot path this whole system is built
 * around. Order of operations:
 *   1. Check Redis. Hit -> return immediately, sub-millisecond.
 *   2. Miss -> query Postgres (indexed point lookup on short_code PK).
 *   3. Populate Redis for next time.
 *   4. Return the URL, or null if it genuinely doesn't exist / is inactive.
 */
export async function resolveShortCode(shortCode: string): Promise<string | null> {
  if (!isValidShortCode(shortCode)) return null;

  const cached = await Cache.get(shortCode);
  if (cached !== null) {
    return cached;
  }

  const record = await UrlModel.findUrlByShortCode(shortCode);
  if (!record) return null;

  if (record.expires_at && record.expires_at < new Date()) {
    return null;
  }

  await Cache.set(shortCode, record.long_url);
  return record.long_url;
}

export async function deleteShortUrl(shortCode: string): Promise<void> {
  await UrlModel.deactivateUrl(shortCode);
  // Invalidate immediately — never serve a deactivated link from a stale
  // cache entry, even within the TTL window.
  await Cache.invalidate(shortCode);
}
