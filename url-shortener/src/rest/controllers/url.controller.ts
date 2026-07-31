import { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env';
import * as ShortenerService from '../../services/shortener.service';
import * as AnalyticsService from '../../services/analytics.service';
import * as UrlModel from '../../models/url.model';

export async function createUrl(req: Request, res: Response, next: NextFunction) {
  try {
    const { long_url, user_id, expires_at } = req.body ?? {};

    if (!long_url || typeof long_url !== 'string') {
      res.status(400).json({ error: 'invalid_request', message: 'long_url is required' });
      return;
    }

    const expiresAt = expires_at ? new Date(expires_at) : null;
    const record = await ShortenerService.createShortUrl(long_url, user_id ?? null, expiresAt);

    res.status(201).json({
      short_code: record.short_code,
      short_url: `${env.baseUrl}/${record.short_code}`,
      long_url: record.long_url,
      created_at: record.created_at,
      expires_at: record.expires_at,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * The redirect handler — the hot path. Every millisecond here is felt
 * at scale, which is why:
 *   - resolution goes through the cache-aside service (Redis first)
 *   - click logging is fired-and-forgotten to a queue, never awaited
 *     inline before responding
 */
export async function redirect(req: Request, res: Response, next: NextFunction) {
  try {
    const { shortCode } = req.params;
    const longUrl = await ShortenerService.resolveShortCode(shortCode);

    if (!longUrl) {
      res.status(404).json({ error: 'not_found', message: 'This short link does not exist or has expired' });
      return;
    }

    // Fire-and-forget: do not await this before responding. The redirect
    // response goes out immediately; analytics land a few hundred ms later.
    AnalyticsService.recordClickAsync({
      shortCode,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      referrer: req.headers['referer'] as string | undefined,
      country: (req.headers['x-vercel-ip-country'] as string) || (req.headers['cf-ipcountry'] as string) || null,
    });

    res.redirect(302, longUrl);
  } catch (err) {
    next(err);
  }
}

export async function getUrlInfo(req: Request, res: Response, next: NextFunction) {
  try {
    const { shortCode } = req.params;
    const longUrl = await ShortenerService.resolveShortCode(shortCode);

    if (!longUrl) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    res.json({ short_code: shortCode, long_url: longUrl });
  } catch (err) {
    next(err);
  }
}

export async function deleteUrl(req: Request, res: Response, next: NextFunction) {
  try {
    const { shortCode } = req.params;
    await ShortenerService.deleteShortUrl(shortCode);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function listUserUrls(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 200);
    const offset = parseInt((req.query.offset as string) ?? '0', 10);

    const urls = await UrlModel.findUrlsByUser(userId, limit, offset);
    res.json({ urls });
  } catch (err) {
    next(err);
  }
}
