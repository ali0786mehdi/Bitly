import { pool } from '../config/database';

export interface UrlRecord {
  short_code: string;
  long_url: string;
  user_id: string | null;
  created_at: Date;
  expires_at: Date | null;
  is_active: boolean;
  click_count: string; // BIGINT comes back as string from node-pg
}

export async function insertUrl(
  shortCode: string,
  longUrl: string,
  userId: string | null,
  expiresAt: Date | null
): Promise<UrlRecord> {
  const result = await pool.query<UrlRecord>(
    `INSERT INTO urls (short_code, long_url, user_id, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [shortCode, longUrl, userId, expiresAt]
  );
  return result.rows[0];
}

export async function findUrlByShortCode(shortCode: string): Promise<UrlRecord | null> {
  const result = await pool.query<UrlRecord>(
    `SELECT * FROM urls WHERE short_code = $1 AND is_active = true`,
    [shortCode]
  );
  return result.rows[0] ?? null;
}

export async function shortCodeExists(shortCode: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM urls WHERE short_code = $1`,
    [shortCode]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findUrlsByUser(userId: string, limit = 50, offset = 0): Promise<UrlRecord[]> {
  const result = await pool.query<UrlRecord>(
    `SELECT * FROM urls
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}

export async function incrementClickCount(shortCode: string): Promise<void> {
  await pool.query(
    `UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1`,
    [shortCode]
  );
}

export async function deactivateUrl(shortCode: string): Promise<void> {
  await pool.query(`UPDATE urls SET is_active = false WHERE short_code = $1`, [shortCode]);
}
