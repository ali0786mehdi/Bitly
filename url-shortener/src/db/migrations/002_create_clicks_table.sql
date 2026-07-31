-- Raw click events. Written on every redirect (async, off the hot path).
-- This table is time-series in nature: high write volume, queries almost
-- always filter by short_code + a time range. If the TimescaleDB extension
-- is available, migration 003 converts this into a hypertable partitioned
-- by clicked_at, which is what makes rollups fast at billions of rows.

CREATE TABLE IF NOT EXISTS clicks (
    id           BIGSERIAL,
    short_code   VARCHAR(16)  NOT NULL,
    clicked_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    country      VARCHAR(2),
    city         VARCHAR(128),
    browser      VARCHAR(64),
    device_type  VARCHAR(32),
    os           VARCHAR(64),
    referrer     TEXT,
    ip_hash      VARCHAR(64),
    PRIMARY KEY (id, clicked_at)
);

-- Composite index: every analytics query is "clicks for this short_code
-- within this time window", so short_code first, then time.
CREATE INDEX IF NOT EXISTS idx_clicks_shortcode_time
    ON clicks (short_code, clicked_at DESC);

CREATE INDEX IF NOT EXISTS idx_clicks_country
    ON clicks (short_code, country);
