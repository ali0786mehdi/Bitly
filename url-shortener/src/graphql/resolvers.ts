import { env } from '../config/env';
import * as ShortenerService from '../services/shortener.service';
import * as AnalyticsService from '../services/analytics.service';
import * as UrlModel from '../models/url.model';

function toUrlPayload(record: UrlModel.UrlRecord) {
  return {
    shortCode: record.short_code,
    shortUrl: `${env.baseUrl}/${record.short_code}`,
    longUrl: record.long_url,
    createdAt: record.created_at.toISOString(),
    expiresAt: record.expires_at ? record.expires_at.toISOString() : null,
    clickCount: record.click_count,
  };
}

export const resolvers = {
  Query: {
    url: async (_: unknown, args: { shortCode: string }) => {
      const record = await UrlModel.findUrlByShortCode(args.shortCode);
      return record ? toUrlPayload(record) : null;
    },
    analytics: async (_: unknown, args: { shortCode: string; days: number }) => {
      const data = await AnalyticsService.getDashboardData(args.shortCode, args.days);
      return {
        shortCode: data.shortCode,
        days: data.days,
        byCountry: data.byCountry.map((r) => ({ value: r.dimension_value, count: r.click_count })),
        byBrowser: data.byBrowser.map((r) => ({ value: r.dimension_value, count: r.click_count })),
        byDevice: data.byDevice.map((r) => ({ value: r.dimension_value, count: r.click_count })),
        overTime: data.overTime.map((r) => ({ bucket: r.bucket.toISOString(), count: r.click_count })),
      };
    },
    userUrls: async (_: unknown, args: { userId: string; limit: number; offset: number }) => {
      const records = await UrlModel.findUrlsByUser(args.userId, args.limit, args.offset);
      return records.map(toUrlPayload);
    },
  },
  Mutation: {
    createUrl: async (_: unknown, args: { longUrl: string; userId?: string; expiresAt?: string }) => {
      const record = await ShortenerService.createShortUrl(
        args.longUrl,
        args.userId ?? null,
        args.expiresAt ? new Date(args.expiresAt) : null
      );
      return toUrlPayload(record);
    },
    deleteUrl: async (_: unknown, args: { shortCode: string }) => {
      await ShortenerService.deleteShortUrl(args.shortCode);
      return true;
    },
  },
};
