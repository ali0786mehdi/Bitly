import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { urlRouter, redirectRouter } from './rest/routes/url.routes';
import { analyticsRouter } from './rest/routes/analytics.routes';
import { errorHandlerMiddleware } from './middleware/errorHandler.middleware';
import { attachGraphQL } from './graphql/server';
import { logger } from './utils/logger';
import { checkDatabaseConnection } from './config/database';
import { checkRedisConnection } from './config/redis';

export async function createApp(): Promise<Express> {
  const app = express();

  // Trust the first proxy hop (CDN / load balancer) so req.ip reflects the
  // real client address for rate limiting and geo headers, not the LB's IP.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors());
  app.use(pinoHttp({ logger }));
  app.use(express.json());

  app.get('/health', async (req, res) => {
    const [dbOk, redisOk] = await Promise.all([checkDatabaseConnection(), checkRedisConnection()]);
    const healthy = dbOk && redisOk;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      database: dbOk ? 'up' : 'down',
      redis: redisOk ? 'up' : 'down',
    });
  });

  // JSON API routes (creation, management, analytics) live under /api.
  app.use(urlRouter);
  app.use(analyticsRouter);

  await attachGraphQL(app);

  // Redirect route is mounted LAST and at the root path — it's a catch-all
  // for any single path segment, so it must not shadow /api or /graphql.
  app.use(redirectRouter);

  app.use(errorHandlerMiddleware());

  return app;
}
