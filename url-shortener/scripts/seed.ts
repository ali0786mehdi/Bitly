import { createShortUrl } from '../src/services/shortener.service';
import { pool } from '../src/config/database';
import { logger } from '../src/utils/logger';

const SAMPLE_URLS = [
  'https://www.anthropic.com',
  'https://github.com',
  'https://developer.mozilla.org',
  'https://www.postgresql.org',
  'https://redis.io',
];

const COUNTRIES = ['US', 'IN', 'GB', 'DE', 'BR'];
const BROWSERS = ['Chrome', 'Safari', 'Firefox', 'Edge'];
const DEVICES = ['desktop', 'mobile', 'tablet'];

async function seed(): Promise<void> {
  logger.info('Seeding sample URLs and click events...');

  for (const longUrl of SAMPLE_URLS) {
    const record = await createShortUrl(longUrl, 'demo-user');
    logger.info({ shortCode: record.short_code, longUrl }, 'Created short URL');

    // Backfill some fake click history so the analytics dashboard has
    // something to show immediately after seeding.
    const clickCount = Math.floor(Math.random() * 200) + 50;
    for (let i = 0; i < clickCount; i++) {
      const daysAgo = Math.floor(Math.random() * 30);
      await pool.query(
        `INSERT INTO clicks (short_code, clicked_at, country, browser, device_type, os)
         VALUES ($1, now() - ($2 || ' days')::interval, $3, $4, $5, 'Unknown')`,
        [
          record.short_code,
          daysAgo,
          COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)],
          BROWSERS[Math.floor(Math.random() * BROWSERS.length)],
          DEVICES[Math.floor(Math.random() * DEVICES.length)],
        ]
      );
    }
    await pool.query('UPDATE urls SET click_count = $2 WHERE short_code = $1', [record.short_code, clickCount]);
  }

  logger.info('Seeding complete');
  await pool.end();
}

seed().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
