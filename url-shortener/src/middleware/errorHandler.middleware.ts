import { Request, Response, NextFunction } from 'express';
import { InvalidUrlError, ShortCodeCollisionError } from '../services/shortener.service';
import { logger } from '../utils/logger';

export function errorHandlerMiddleware() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: Error, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof InvalidUrlError) {
      res.status(400).json({ error: 'invalid_url', message: err.message });
      return;
    }

    if (err instanceof ShortCodeCollisionError) {
      res.status(503).json({ error: 'short_code_exhausted', message: err.message });
      return;
    }

    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    res.status(500).json({ error: 'internal_server_error', message: 'Something went wrong' });
  };
}
