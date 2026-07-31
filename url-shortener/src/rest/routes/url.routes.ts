import { Router } from 'express';
import * as UrlController from '../controllers/url.controller';
import { rateLimitMiddleware } from '../../middleware/rateLimit.middleware';

export const urlRouter = Router();

// Creation is rate-limited more strictly than redirection since it writes.
urlRouter.post('/api/urls', rateLimitMiddleware(), UrlController.createUrl);
urlRouter.get('/api/urls/:shortCode', UrlController.getUrlInfo);
urlRouter.delete('/api/urls/:shortCode', UrlController.deleteUrl);
urlRouter.get('/api/users/:userId/urls', UrlController.listUserUrls);

// The redirect route lives at the root path (e.g. GET /aZ3kP1) to match
// how real short links look — no /api prefix here.
export const redirectRouter = Router();
redirectRouter.get('/:shortCode', rateLimitMiddleware(), UrlController.redirect);
