import { pool } from '../config/database';

export interface ClickEvent {
  short_code: string;
  country: string | null;
  city: string | null;
  browser: string | null;
  device_type: string | null;
  os: string | null;
  referrer: string | null;
  ip_hash: string | null;
}

export async function insertClick(event: ClickEvent): Promise<void> {
  await pool.query(
    `INSERT INTO clicks (short_code, country, city, browser, device_type, os, referrer, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      event.short_code,
      event.country,
      event.city,
      event.browser,
      event.device_type,
      event.os,
      event.referrer,
      event.ip_hash,
    ]
  );
}

export interface ClicksByDimensionRow {
  dimension_value: string;
  click_count: string;
}

export async function getClicksByCountry(shortCode: string, days: number): Promise<ClicksByDimensionRow[]> {
  const result = await pool.query<ClicksByDimensionRow>(
    `SELECT country AS dimension_value, count(*)::text AS click_count
     FROM clicks
     WHERE short_code = $1
       AND clicked_at >= now() - ($2 || ' days')::interval
       AND country IS NOT NULL
     GROUP BY country
     ORDER BY click_count DESC`,
    [shortCode, days]
  );
  return result.rows;
}

export async function getClicksByBrowser(shortCode: string, days: number): Promise<ClicksByDimensionRow[]> {
  const result = await pool.query<ClicksByDimensionRow>(
    `SELECT browser AS dimension_value, count(*)::text AS click_count
     FROM clicks
     WHERE short_code = $1
       AND clicked_at >= now() - ($2 || ' days')::interval
       AND browser IS NOT NULL
     GROUP BY browser
     ORDER BY click_count DESC`,
    [shortCode, days]
  );
  return result.rows;
}

export async function getClicksByDevice(shortCode: string, days: number): Promise<ClicksByDimensionRow[]> {
  const result = await pool.query<ClicksByDimensionRow>(
    `SELECT device_type AS dimension_value, count(*)::text AS click_count
     FROM clicks
     WHERE short_code = $1
       AND clicked_at >= now() - ($2 || ' days')::interval
       AND device_type IS NOT NULL
     GROUP BY device_type
     ORDER BY click_count DESC`,
    [shortCode, days]
  );
  return result.rows;
}

export interface ClicksOverTimeRow {
  bucket: Date;
  click_count: string;
}

export async function getClicksOverTime(shortCode: string, days: number): Promise<ClicksOverTimeRow[]> {
  const result = await pool.query<ClicksOverTimeRow>(
    `SELECT date_trunc('hour', clicked_at) AS bucket, count(*)::text AS click_count
     FROM clicks
     WHERE short_code = $1
       AND clicked_at >= now() - ($2 || ' days')::interval
     GROUP BY bucket
     ORDER BY bucket ASC`,
    [shortCode, days]
  );
  return result.rows;
}
