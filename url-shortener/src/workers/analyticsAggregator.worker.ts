import { pool } from '../config/database';
import { drainClickQueue } from '../services/analytics.service';
import * as UrlModel from '../models/url.model';
import { logger } from '../utils/logger';

const BATCH_SIZE = 500;
const POLL_INTERVAL_MS = 1000;

/**
 * Runs as a separate process from the API server (see docker-compose.yml,
 * service `worker`). This decoupling is the point: the redirect path only
 * ever does a Redis LPUSH (microseconds); all the relatively expensive
 * work — parsing user agents, writing to Postgres, updating counters —
 * happens here, off the request path, and can be scaled independently
 * (e.g. run 3 worker replicas if the queue backs up under load).
 */
async function processBatch(): Promise<number> {
  const events = await drainClickQueue(BATCH_SIZE);
  if (events.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const event of events) {
      await client.query(
        `INSERT INTO clicks (short_code, country, city, browser, device_type, os, referrer, ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          event.short_code,
          event.country,
          event.city,
          event.browser,
          event.device_type,
          event.os,
          event.referrer,
          event.ip_hash,
        ]
      );
    }

    // Batch-increment click_count per short_code rather than one UPDATE
    // per event, so a burst of clicks on the same link doesn't serialize
    // on row locks.
    const counts = events.reduce<Record<string, number>>((acc, e) => {
      acc[e.short_code] = (acc[e.short_code] ?? 0) + 1;
      return acc;
    }, {});

    for (const [shortCode, count] of Object.entries(counts)) {
      await client.query(
        `UPDATE urls SET click_count = click_count + $2 WHERE short_code = $1`,
        [shortCode, count]
      );
    }

    await client.query('COMMIT');
    return events.length;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Batch write failed, events lost from this batch');
    return 0;
  } finally {
    client.release();
  }
}

async function run(): Promise<void> {
  logger.info('Analytics aggregator worker started');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const processed = await processBatch();
      if (processed > 0) {
        logger.info({ processed }, 'Flushed click events to Postgres');
      }
    } catch (err) {
      logger.error({ err }, 'Worker loop error');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

if (require.main === module) {
  run();
}

export { processBatch, UrlModel };
