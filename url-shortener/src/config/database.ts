import { Pool } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: env.pgPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Unexpected errors on idle clients — log and let the pool recover,
  // never crash the process over a single dropped connection.
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    logger.error({ err }, 'Database connection check failed');
    return false;
  }
}
