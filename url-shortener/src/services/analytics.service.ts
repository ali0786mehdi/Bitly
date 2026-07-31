import { UAParser } from 'ua-parser-js';
import crypto from 'crypto';
import { redis } from '../config/redis';
import * as ClickModel from '../models/click.model';
import { logger } from '../utils/logger';

const CLICK_QUEUE_KEY = 'analytics:click_queue';

export interface RawClickInput {
  shortCode: string;
  userAgent: string | undefined;
  ip: string | undefined;
  referrer: string | undefined;
  country: string | null; // resolved upstream (CDN geo header) or null
}

/**
 * Enqueues a click event and returns immediately. This is the key design
 * decision that keeps the redirect path fast: analytics logging never
 * blocks the 302 response. A background worker (analyticsAggregator.worker.ts)
 * drains this queue and writes to Postgres in batches.
 */
export async function recordClickAsync(input: RawClickInput): Promise<void> {
  const parser = new UAParser(input.userAgent ?? '');
  const uaResult = parser.getResult();

  const event: ClickModel.ClickEvent = {
    short_code: input.shortCode,
    country: input.country,
    city: null, // would come from a GeoIP DB (e.g. MaxMind) in production
    browser: uaResult.browser.name ?? 'Unknown',
    device_type: uaResult.device.type ?? 'desktop',
    os: uaResult.os.name ?? 'Unknown',
    referrer: input.referrer ?? null,
    // Hash the IP rather than storing it raw — enough for rough uniqueness
    // analysis without retaining PII long-term.
    ip_hash: input.ip ? crypto.createHash('sha256').update(input.ip).digest('hex').slice(0, 32) : null,
  };

  try {
    await redis.lpush(CLICK_QUEUE_KEY, JSON.stringify(event));
  } catch (err) {
    // If Redis itself is down, we lose this one click event rather than
    // blocking or failing the redirect. Acceptable trade-off for an
    // analytics-only write; never acceptable for the redirect itself.
    logger.error({ err }, 'Failed to enqueue click event');
  }
}

export async function drainClickQueue(batchSize: number): Promise<ClickModel.ClickEvent[]> {
  // Batch-drain via a pipeline of RPOP calls — one round trip instead of
  // N, which matters when the worker is pulling thousands of events/sec.
  const pipeline = redis.pipeline();
  for (let i = 0; i < batchSize; i++) pipeline.rpop(CLICK_QUEUE_KEY);
  const results = await pipeline.exec();

  return (results ?? [])
    .map(([, value]) => value)
    .filter((v): v is string => typeof v === 'string')
    .map((v) => JSON.parse(v) as ClickModel.ClickEvent);
}

export async function getDashboardData(shortCode: string, days: number) {
  const [byCountry, byBrowser, byDevice, overTime] = await Promise.all([
    ClickModel.getClicksByCountry(shortCode, days),
    ClickModel.getClicksByBrowser(shortCode, days),
    ClickModel.getClicksByDevice(shortCode, days),
    ClickModel.getClicksOverTime(shortCode, days),
  ]);

  return { shortCode, days, byCountry, byBrowser, byDevice, overTime };
}
