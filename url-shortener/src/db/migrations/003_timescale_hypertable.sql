-- OPTIONAL: only runs if the TimescaleDB extension is installed on your
-- Postgres instance. If you're running plain Postgres, skip this migration —
-- everything else works fine on vanilla Postgres, just without automatic
-- time-partitioning. See README "Analytics engine" section.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Convert clicks into a hypertable, chunked by week. Chunking keeps each
-- chunk (and its indexes) small enough to stay in memory, which is what
-- keeps rollup queries fast even as the table grows into the billions.
SELECT create_hypertable(
    'clicks',
    'clicked_at',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Continuous aggregate: pre-computed hourly click counts per short_code.
-- The dashboard queries this materialized rollup instead of scanning raw
-- click rows, which is what makes "clicks by day for the last 90 days"
-- return in milliseconds instead of seconds.
CREATE MATERIALIZED VIEW IF NOT EXISTS clicks_hourly
WITH (timescaledb.continuous) AS
SELECT
    short_code,
    time_bucket('1 hour', clicked_at) AS bucket,
    country,
    device_type,
    browser,
    count(*) AS click_count
FROM clicks
GROUP BY short_code, bucket, country, device_type, browser
WITH NO DATA;

SELECT add_continuous_aggregate_policy('clicks_hourly',
    start_offset => INTERVAL '3 days',
    end_offset   => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- Retention policy: drop raw click rows older than 1 year, keep the hourly
-- rollups forever (they're a fraction of the size).
SELECT add_retention_policy('clicks', INTERVAL '365 days', if_not_exists => TRUE);
