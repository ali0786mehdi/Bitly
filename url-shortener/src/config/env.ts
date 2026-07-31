import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: parseInt(required('PORT', '4000'), 10),
  nodeEnv: required('NODE_ENV', 'development'),
  baseUrl: required('BASE_URL', 'http://localhost:4000'),

  databaseUrl: required('DATABASE_URL', 'postgres://shortener:shortener@localhost:5432/shortener'),
  pgPoolMax: parseInt(required('PG_POOL_MAX', '20'), 10),

  redisUrl: required('REDIS_URL', 'redis://localhost:6379'),
  cacheTtlSeconds: parseInt(required('CACHE_TTL_SECONDS', '3600'), 10),

  rateLimitCapacity: parseInt(required('RATE_LIMIT_CAPACITY', '100'), 10),
  rateLimitRefillPerSec: parseInt(required('RATE_LIMIT_REFILL_PER_SEC', '10'), 10),

  shortCodeLength: parseInt(required('SHORT_CODE_LENGTH', '7'), 10),
};
