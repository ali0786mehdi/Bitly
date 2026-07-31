import { Request, Response, NextFunction } from 'express';
import * as AnalyticsService from '../../services/analytics.service';

export async function getDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const { shortCode } = req.params;
    const days = Math.min(parseInt((req.query.days as string) ?? '30', 10), 365);

    const data = await AnalyticsService.getDashboardData(shortCode, days);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
