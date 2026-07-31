import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

export const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    // Exponential backoff capped at 5s — avoids a reconnect storm if Redis
    // is briefly unavailable, while still recovering quickly.
    return Math.min(times * 200, 5000);
  },
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

export async function checkRedisConnection(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (err) {
    logger.error({ err }, 'Redis connection check failed');
    return false;
  }
}
