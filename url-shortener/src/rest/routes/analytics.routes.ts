import { Router } from 'express';
import * as AnalyticsController from '../controllers/analytics.controller';

export const analyticsRouter = Router();

analyticsRouter.get('/api/analytics/:shortCode', AnalyticsController.getDashboard);
