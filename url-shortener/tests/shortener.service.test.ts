import * as UrlModel from '../src/models/url.model';
import * as Cache from '../src/services/cache.service';

jest.mock('../src/models/url.model');
jest.mock('../src/services/cache.service');

import { createShortUrl, resolveShortCode, InvalidUrlError } from '../src/services/shortener.service';

const mockedUrlModel = UrlModel as jest.Mocked<typeof UrlModel>;
const mockedCache = Cache as jest.Mocked<typeof Cache>;

describe('shortener.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createShortUrl', () => {
    it('rejects a malformed long URL before touching the database', async () => {
      await expect(createShortUrl('not-a-url')).rejects.toThrow(InvalidUrlError);
      expect(mockedUrlModel.insertUrl).not.toHaveBeenCalled();
    });

    it('inserts the URL and writes through to cache on success', async () => {
      mockedUrlModel.insertUrl.mockResolvedValueOnce({
        short_code: 'abc1234',
        long_url: 'https://example.com',
        user_id: null,
        created_at: new Date(),
        expires_at: null,
        is_active: true,
        click_count: '0',
      });

      const record = await createShortUrl('https://example.com');

      expect(record.short_code).toBe('abc1234');
      expect(mockedCache.writeThrough).toHaveBeenCalledWith('abc1234', 'https://example.com');
    });

    it('retries on a primary-key collision (Postgres error code 23505)', async () => {
      const collisionError = Object.assign(new Error('duplicate key'), { code: '23505' });
      mockedUrlModel.insertUrl
        .mockRejectedValueOnce(collisionError)
        .mockResolvedValueOnce({
          short_code: 'retry01',
          long_url: 'https://example.com',
          user_id: null,
          created_at: new Date(),
          expires_at: null,
          is_active: true,
          click_count: '0',
        });

      const record = await createShortUrl('https://example.com');

      expect(mockedUrlModel.insertUrl).toHaveBeenCalledTimes(2);
      expect(record.short_code).toBe('retry01');
    });
  });

  describe('resolveShortCode', () => {
    it('returns the cached value without hitting the database on a cache hit', async () => {
      mockedCache.get.mockResolvedValueOnce('https://cached-example.com');

      const result = await resolveShortCode('abc1234');

      expect(result).toBe('https://cached-example.com');
      expect(mockedUrlModel.findUrlByShortCode).not.toHaveBeenCalled();
    });

    it('falls through to the database on a cache miss and populates the cache', async () => {
      mockedCache.get.mockResolvedValueOnce(null);
      mockedUrlModel.findUrlByShortCode.mockResolvedValueOnce({
        short_code: 'abc1234',
        long_url: 'https://db-example.com',
        user_id: null,
        created_at: new Date(),
        expires_at: null,
        is_active: true,
        click_count: '0',
      });

      const result = await resolveShortCode('abc1234');

      expect(result).toBe('https://db-example.com');
      expect(mockedCache.set).toHaveBeenCalledWith('abc1234', 'https://db-example.com');
    });

    it('returns null for an invalid short code without querying anything', async () => {
      const result = await resolveShortCode('has spaces');
      expect(result).toBeNull();
      expect(mockedCache.get).not.toHaveBeenCalled();
    });

    it('returns null for an expired link even if cached elsewhere', async () => {
      mockedCache.get.mockResolvedValueOnce(null);
      mockedUrlModel.findUrlByShortCode.mockResolvedValueOnce({
        short_code: 'expired1',
        long_url: 'https://expired-example.com',
        user_id: null,
        created_at: new Date(),
        expires_at: new Date(Date.now() - 1000 * 60), // 1 minute ago
        is_active: true,
        click_count: '0',
      });

      const result = await resolveShortCode('expired1');
      expect(result).toBeNull();
    });
  });
});
