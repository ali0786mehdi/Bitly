import fs from 'fs';
import path from 'path';
import { pool } from '../config/database';
import { logger } from '../utils/logger';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((r) => r.filename));
}

async function run(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      logger.info({ file }, 'Skipping already-applied migration');
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    logger.info({ file }, 'Applying migration');

    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      logger.info({ file }, 'Migration applied successfully');
    } catch (err) {
      // Migration 003 depends on the TimescaleDB extension being
      // installed. If it's not available (e.g. plain Postgres in local
      // dev), skip it rather than failing the whole migration run.
      if (file.includes('timescale')) {
        logger.warn(
          { file, err },
          'TimescaleDB extension not available — skipping. System works on plain Postgres, just without hypertable partitioning.'
        );
        continue;
      }
      throw err;
    }
  }

  logger.info('All migrations complete');
  await pool.end();
}

run().catch((err) => {
  logger.error({ err }, 'Migration failed');
  process.exit(1);
});
