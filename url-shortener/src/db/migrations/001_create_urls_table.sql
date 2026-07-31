-- URLs table: the source of truth for short_code -> long_url mappings.
-- short_code is the primary access pattern (point lookup on every redirect),
-- so it is the primary key. A UNIQUE B-tree index is created implicitly.

CREATE TABLE IF NOT EXISTS urls (
    short_code   VARCHAR(16)  PRIMARY KEY,
    long_url     TEXT         NOT NULL,
    user_id      VARCHAR(64),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ,
    is_active    BOOLEAN      NOT NULL DEFAULT true,
    click_count  BIGINT       NOT NULL DEFAULT 0
);

-- Secondary index for "all links created by user X" — a separate access
-- pattern from the redirect hot path, sorted by recency.
CREATE INDEX IF NOT EXISTS idx_urls_user_created
    ON urls (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

-- Partial index to speed up expiry sweeps without scanning permanent links.
CREATE INDEX IF NOT EXISTS idx_urls_expires_at
    ON urls (expires_at)
    WHERE expires_at IS NOT NULL;
