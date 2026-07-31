import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { pool } from './config/database';
import { redis } from './config/redis';

async function main(): Promise<void> {
  const app = await createApp();

  const server = app.listen(env.port, () => {
    logger.info(`Server listening on port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully`);
    server.close(async () => {
      await pool.end();
      redis.disconnect();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Force-exit if graceful shutdown hangs for more than 10s.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error during startup');
  process.exit(1);
});
