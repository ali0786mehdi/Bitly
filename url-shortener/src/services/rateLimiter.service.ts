import { redis } from '../config/redis';
import { env } from '../config/env';

/**
 * Token bucket rate limiter, implemented as a Lua script so the
 * read-modify-write cycle (check tokens, refill, decrement) is atomic
 * even under concurrent requests hitting the same key from different
 * app instances. Without atomicity, two concurrent requests could both
 * read "1 token left" and both be allowed through — a classic race
 * condition in naive rate limiter implementations.
 *
 * Algorithm: each key has `tokens` (float) and `last_refill` (ms epoch).
 * On each request: refill = elapsed_seconds * refill_rate, cap at capacity,
 * then attempt to consume 1 token.
 */
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_sec = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  last_refill = now
end

local elapsed = math.max(0, now - last_refill)
local refill = elapsed * (refill_per_sec / 1000.0)
tokens = math.min(capacity, tokens + refill)

local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
redis.call('EXPIRE', key, 3600)

return { allowed, tokens }
`;

export interface RateLimitResult {
  allowed: boolean;
  remainingTokens: number;
}

export async function checkTokenBucket(
  identifier: string,
  capacity: number = env.rateLimitCapacity,
  refillPerSec: number = env.rateLimitRefillPerSec,
  cost = 1
): Promise<RateLimitResult> {
  const key = `ratelimit:tb:${identifier}`;
  const now = Date.now();

  const result = (await redis.eval(
    TOKEN_BUCKET_SCRIPT,
    1,
    key,
    capacity,
    refillPerSec,
    now,
    cost
  )) as [number, number];

  return {
    allowed: result[0] === 1,
    remainingTokens: result[1],
  };
}

/**
 * Sliding window log: keeps exact timestamps in a Redis sorted set and
 * counts requests within the trailing window. More memory-heavy than
 * token bucket, but gives you an exact count with no burst allowance —
 * useful for stricter limits like "max 5 short URLs created per minute
 * per account" where you don't want any burst tolerance at all.
 */
export async function checkSlidingWindowLog(
  identifier: string,
  maxRequests: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const key = `ratelimit:swl:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, windowStart);
  pipeline.zcard(key);
  const results = await pipeline.exec();

  const currentCount = (results?.[1]?.[1] as number) ?? 0;

  if (currentCount >= maxRequests) {
    return { allowed: false, remainingTokens: 0 };
  }

  await redis.zadd(key, now, `${now}-${Math.random()}`);
  await redis.expire(key, windowSeconds);

  return { allowed: true, remainingTokens: maxRequests - currentCount - 1 };
}
