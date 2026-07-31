import { Request, Response, NextFunction } from 'express';
import { checkTokenBucket } from '../services/rateLimiter.service';

/**
 * Applies a token bucket limit keyed by client IP. In production behind a
 * CDN/load balancer, trust the `X-Forwarded-For` header (set `app.set('trust
 * proxy', true)` in app.ts, already done) rather than the raw socket IP,
 * which would otherwise be the load balancer's own address for every request.
 */
export function rateLimitMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = req.ip ?? 'unknown';

    const { allowed, remainingTokens } = await checkTokenBucket(identifier);

    res.setHeader('X-RateLimit-Remaining', Math.floor(remainingTokens).toString());

    if (!allowed) {
      res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests. Please slow down.',
      });
      return;
    }

    next();
  };
}
