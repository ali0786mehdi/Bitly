# URL Shortener + Analytics Engine

A high-performance `bit.ly`-style URL shortener built from scratch in TypeScript, designed around one hard constraint: **the redirect has to survive billions of clicks without slowing down**, while a completely separate analytics pipeline captures every click for a dashboard (by country, browser, device, and time) without ever touching the hot path.

Both a **REST API** and a **GraphQL API** are exposed side by side over the same service layer, so you can compare the two directly.

---

## Table of contents

- [Why this architecture](#why-this-architecture)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [How the redirect stays fast](#how-the-redirect-stays-fast)
- [How the analytics engine works](#how-the-analytics-engine-works)
- [Rate limiting](#rate-limiting)
- [Database indexing](#database-indexing)
- [Getting started](#getting-started)
- [API reference](#api-reference)
- [GraphQL reference](#graphql-reference)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [Horizontal scaling & CDN notes](#horizontal-scaling--cdn-notes)
- [Design decisions & trade-offs](#design-decisions--trade-offs)
- [Roadmap](#roadmap)

---

## Why this architecture

A URL shortener sounds trivial — store a mapping, redirect on lookup. It stops being trivial the moment you ask two questions:

1. **What happens when the same short link gets hit a million times a minute?** A database point-lookup on every single redirect will not survive that. You need a cache in front of the database, and the cache strategy (what gets cached, when it's invalidated, what happens on a miss) is the actual engineering problem.
2. **How do you log every click for analytics without slowing down the redirect?** If click-logging is written synchronously before the redirect response goes out, your p99 latency is now bounded by your analytics writes, not your cache. The fix is to decouple them completely — the redirect responds immediately, and a background worker drains a queue of click events into the analytics store.

Everything in this repo is built around those two decisions.

---

## Tech stack

| Layer                  | Choice                              | Why |
|-------------------------|--------------------------------------|-----|
| Language                | TypeScript (strict mode)             | Type safety across the DB → service → API boundary |
| API server               | Express                              | Minimal, well-understood, plays nicely with both REST and GraphQL |
| GraphQL                 | Apollo Server 4                      | Industry standard, mounts cleanly as Express middleware |
| Cache                    | Redis (ioredis)                      | Sub-millisecond reads, atomic Lua scripting for rate limiting |
| Primary datastore        | PostgreSQL                            | ACID guarantees for the URL mapping table (source of truth) |
| Analytics datastore       | PostgreSQL + TimescaleDB extension (optional) | Hypertables + continuous aggregates make time-series rollups fast at scale; falls back to plain Postgres if Timescale isn't installed |
| Queue                    | Redis list (LPUSH/RPOP)               | Simple, fast, good enough to decouple the redirect from analytics writes. See [Roadmap](#roadmap) for Kafka as a production upgrade |
| Containerization          | Docker + Docker Compose               | One command to bring up Postgres, Redis, the API, and the worker |

---

## Project structure

```
url-shortener/
├── README.md
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── jest.config.js
│
├── src/
│   ├── index.ts                        # Process entry point, graceful shutdown
│   ├── app.ts                          # Express app assembly (middleware + routes)
│   │
│   ├── config/
│   │   ├── env.ts                      # Centralized, validated environment config
│   │   ├── database.ts                 # PostgreSQL connection pool
│   │   └── redis.ts                    # Redis client with retry strategy
│   │
│   ├── db/
│   │   ├── migrate.ts                  # Migration runner (tracks applied migrations)
│   │   └── migrations/
│   │       ├── 001_create_urls_table.sql
│   │       ├── 002_create_clicks_table.sql
│   │       └── 003_timescale_hypertable.sql   # Optional Timescale upgrade
│   │
│   ├── models/                         # Typed, parameterized SQL — no ORM
│   │   ├── url.model.ts
│   │   └── click.model.ts
│   │
│   ├── services/                       # Business logic, shared by REST and GraphQL
│   │   ├── shortener.service.ts        # Creation + cache-aside redirect resolution
│   │   ├── cache.service.ts            # Cache-aside / write-through / invalidation
│   │   ├── rateLimiter.service.ts      # Token bucket + sliding window log
│   │   └── analytics.service.ts        # Async click ingestion + dashboard queries
│   │
│   ├── rest/
│   │   ├── routes/
│   │   │   ├── url.routes.ts
│   │   │   └── analytics.routes.ts
│   │   └── controllers/
│   │       ├── url.controller.ts
│   │       └── analytics.controller.ts
│   │
│   ├── graphql/
│   │   ├── schema.ts                   # SDL type definitions
│   │   ├── resolvers.ts                # Resolvers wired to the same services as REST
│   │   └── server.ts                   # Apollo Server, mounted at /graphql
│   │
│   ├── middleware/
│   │   ├── rateLimit.middleware.ts
│   │   └── errorHandler.middleware.ts
│   │
│   ├── workers/
│   │   └── analyticsAggregator.worker.ts   # Drains the click queue, batch-writes to Postgres
│   │
│   └── utils/
│       ├── base62.ts                   # Short code generation
│       └── logger.ts                   # Structured logging (pino)
│
├── scripts/
│   └── seed.ts                         # Local dev seed data
│
└── tests/
    ├── base62.test.ts
    └── shortener.service.test.ts
```

**Why this layout:** REST controllers and GraphQL resolvers are both thin — they call into `services/`, never touch the database directly. This means the caching strategy, rate limiting, and analytics logic are implemented exactly once and used identically by both APIs, which is the only way a REST-vs-GraphQL comparison is actually fair.

---

## How the redirect stays fast

```
GET /aZ3kP1
   │
   ▼
Redis GET "url:aZ3kP1"
   │
   ├── HIT  → return long_url immediately (sub-millisecond)
   │
   └── MISS → SELECT long_url FROM urls WHERE short_code = 'aZ3kP1'
                (indexed point lookup on the primary key)
                │
                ▼
              Redis SET "url:aZ3kP1" (TTL applied)
                │
                ▼
              return long_url
```

This is the **cache-aside** pattern, implemented in [`cache.service.ts`](src/services/cache.service.ts) and [`shortener.service.ts`](src/services/shortener.service.ts):

- **Cache-aside reads** — the application checks Redis first and only queries Postgres on a miss. If Redis itself is unavailable, the code degrades to "cache miss" and falls through to Postgres rather than failing the request — the cache is an optimization, never a dependency the redirect can't survive without.
- **Write-through on creation** — when a short URL is created, it's written to Redis immediately (not just Postgres), so the very first redirect is already a cache hit instead of a guaranteed miss.
- **Invalidation on delete** — deactivating a link calls `Cache.invalidate()` immediately, so a deleted link is never served from a stale cache entry even within its TTL window.
- **Click logging never blocks the response** — see the next section. The redirect handler fires an async event and responds with the 302 immediately; it does not `await` the analytics write.

---

## How the analytics engine works

```
Redirect handler                    Background worker (separate process)
─────────────────                   ─────────────────────────────────────
GET /aZ3kP1
  │
  ├─ resolve URL (cache-aside)
  ├─ LPUSH click event to Redis  ──────►  loop:
  │    (fire-and-forget, not awaited)       RPOP batch of events (500 at a time)
  │                                          BEGIN transaction
  └─ 302 redirect (already returned)         INSERT each click into `clicks`
                                              batch UPDATE click_count per short_code
                                             COMMIT
                                             (poll again in 1s)
```

- The **queue** is a Redis list. The redirect path does one `LPUSH` (microseconds) and moves on — it never waits on a database write.
- The **worker** ([`analyticsAggregator.worker.ts`](src/workers/analyticsAggregator.worker.ts)) runs as its own process (`npm run worker`, or the `worker` service in `docker-compose.yml`), polling the queue and batch-writing to Postgres. Because it's a separate process, it scales independently — if the queue backs up under load, run more worker replicas without touching the API tier at all.
- **User agent parsing** (browser, OS, device type) happens in the worker via `ua-parser-js`, not in the request path.
- **Country resolution** reads a geo header set by a CDN/edge layer (e.g. `CF-IPCountry` from Cloudflare, or the equivalent from your CDN) — see [`analytics.service.ts`](src/services/analytics.service.ts). No GeoIP database lookup happens synchronously in the request path.
- **IP addresses are hashed** (SHA-256, truncated) before storage, not stored raw — enough for uniqueness analysis without retaining PII indefinitely.

### Why TimescaleDB (optional)

The `clicks` table is written at high volume and queried almost exclusively as "clicks for this short_code within this time range" — a textbook time-series access pattern. Migration `003_timescale_hypertable.sql`:

- Converts `clicks` into a **hypertable**, auto-partitioned into weekly chunks. Each chunk (and its indexes) stays small enough to fit in memory, which is what keeps rollup queries fast even at billions of rows — instead of one enormous table and index, you get many small ones.
- Creates a **continuous aggregate** (`clicks_hourly`) that pre-computes hourly click counts by country/browser/device. The dashboard queries this materialized rollup instead of scanning raw click rows.
- Adds a **retention policy** that drops raw click rows older than a year while keeping the hourly rollups forever.

This migration is fully optional and wrapped in a try/skip in the migration runner — **the system works correctly on plain Postgres**, just without automatic time-partitioning. If you're running local Postgres without the extension, migrations 001 and 002 are all you need.

---

## Rate limiting

Two algorithms are implemented in [`rateLimiter.service.ts`](src/services/rateLimiter.service.ts), both backed by Redis so the limit is enforced correctly across multiple horizontally-scaled API instances (an in-memory counter would only rate-limit per-instance, which is wrong):

- **Token bucket** (`checkTokenBucket`) — used on the redirect and creation routes. Each identifier (IP address) has a bucket that refills continuously at a fixed rate and allows short bursts up to its capacity. Implemented as a single atomic Lua script (`EVAL`), so the read → refill → decrement cycle can't race across concurrent requests hitting the same key from different instances — a plain GET-then-SET implementation would let two concurrent requests both read "1 token left" and both be allowed through.
- **Sliding window log** (`checkSlidingWindowLog`) — an exact, stricter alternative using a Redis sorted set of timestamps. No burst allowance, at the cost of more memory per key. Available for cases like "max 5 short URLs created per minute per account" where you want a hard exact cap.

---

## Database indexing

See [`001_create_urls_table.sql`](src/db/migrations/001_create_urls_table.sql) and [`002_create_clicks_table.sql`](src/db/migrations/002_create_clicks_table.sql) for the full reasoning in comments. Summary:

- `urls.short_code` is the **primary key** — the redirect's only access pattern is an equality lookup on this column, so it gets a unique index automatically. At 7 base62 characters, that's 62⁷ ≈ 3.5 trillion possible codes, keeping the index shallow and collision probability negligible even at billions of rows.
- A secondary composite index on `(user_id, created_at DESC)` supports "list my links" — a different access pattern from the redirect hot path, kept as a separate index rather than overloading the primary key's index.
- `clicks` is indexed as `(short_code, clicked_at DESC)` — every analytics query filters by short_code first, then a time range, so the index matches the query shape exactly.

---

## Getting started

### Option A — Docker Compose (recommended, zero local setup)

```bash
git clone <your-repo-url>
cd url-shortener
cp .env.example .env

docker compose up --build
```

This brings up Postgres (with the TimescaleDB extension available), Redis, the API server, and the analytics worker together. Then, in a second terminal:

```bash
docker compose exec api npm run migrate
docker compose exec api npm run seed   # optional: sample data for the dashboard
```

The API is now live at `http://localhost:4000`.

### Option B — Local Node.js (Postgres/Redis running separately)

```bash
npm install
cp .env.example .env   # point DATABASE_URL / REDIS_URL at your local instances

npm run migrate
npm run seed            # optional

npm run dev              # API server, with hot reload
npm run worker           # in a second terminal — the analytics worker
```

### Verify it's working

```bash
curl http://localhost:4000/health
# { "status": "ok", "database": "up", "redis": "up" }

curl -X POST http://localhost:4000/api/urls \
  -H "Content-Type: application/json" \
  -d '{"long_url": "https://www.anthropic.com"}'
# { "short_code": "aZ3kP1x", "short_url": "http://localhost:4000/aZ3kP1x", ... }

curl -L http://localhost:4000/aZ3kP1x
# redirects to https://www.anthropic.com
```

---

## API reference

### REST

| Method | Path                          | Description |
|--------|--------------------------------|--------------|
| `POST` | `/api/urls`                    | Create a short URL. Body: `{ long_url, user_id?, expires_at? }` |
| `GET`  | `/api/urls/:shortCode`         | Look up the long URL for a short code (JSON, no redirect) |
| `DELETE` | `/api/urls/:shortCode`       | Deactivate a short URL and invalidate its cache entry |
| `GET`  | `/api/users/:userId/urls`      | List a user's short URLs (paginated via `?limit=&offset=`) |
| `GET`  | `/api/analytics/:shortCode`    | Dashboard data: clicks by country/browser/device + over time. `?days=30` |
| `GET`  | `/:shortCode`                  | **The redirect itself.** 302 to the long URL, or 404 if not found/expired |
| `GET`  | `/health`                      | Liveness check — reports Postgres and Redis connectivity |

### GraphQL

Available at `POST /graphql`. Schema in [`src/graphql/schema.ts`](src/graphql/schema.ts).

```graphql
mutation {
  createUrl(longUrl: "https://www.anthropic.com") {
    shortCode
    shortUrl
  }
}

query {
  analytics(shortCode: "aZ3kP1x", days: 7) {
    byCountry { value count }
    byBrowser { value count }
    overTime { bucket count }
  }
}
```

**REST vs GraphQL, as actually observed in this codebase:** REST's `/api/analytics/:shortCode` always returns all four breakdowns (country, browser, device, time) whether the client needs them or not. The GraphQL `analytics` query lets the client ask for only `byCountry` if that's all the dashboard widget needs — no over-fetching. The trade-off: the REST route is a single indexed URL you can cache at a CDN edge; the GraphQL endpoint is a single `POST /graphql` for everything, which is harder to cache at the HTTP layer without additional tooling (persisted queries, etc.).

---

## Environment variables

See [`.env.example`](.env.example) for the full list with defaults. Key ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `CACHE_TTL_SECONDS` | How long a redirect stays cached before falling back to the DB on next read |
| `RATE_LIMIT_CAPACITY` / `RATE_LIMIT_REFILL_PER_SEC` | Token bucket parameters |
| `SHORT_CODE_LENGTH` | Length of generated short codes (default 7) |

---

## Testing

```bash
npm test
```

Unit tests mock the model/cache layers so they run without a live Postgres or Redis connection — fast, deterministic, and safe to run in CI. Coverage includes:

- Short code generation: correct length, URL-safe alphabet, collision sanity check across 1,000 generations
- Malformed URL rejection before any database call
- Write-through caching on creation, using the DB-confirmed short code (not the pre-insert local variable)
- Collision retry logic on a simulated Postgres unique-violation (error code `23505`)
- Cache-aside resolution: cache hit skips the DB, cache miss falls through and populates the cache
- Expired-link handling even when a stale cache entry exists

Run `npm run migrate` against a real (or Dockerized) Postgres instance before integration-testing the full stack end-to-end — the unit test suite intentionally does not require one.

---

## Horizontal scaling & CDN notes

- **The API and worker are stateless.** Neither holds any state outside Redis/Postgres, so scaling out is just running more replicas: `docker compose up --scale api=3 --scale worker=2`. Put a load balancer in front of the API replicas; nothing in the app needs sticky sessions.
- **Rate limiting is correct under horizontal scaling** because the token bucket state lives in Redis, not in-process memory — every replica sees the same bucket for a given IP.
- **CDN integration**: in production, put a CDN in front of the redirect route. Two things matter: (1) most CDNs can cache a `302` response for a short TTL, serving repeat hits to the same short link without even reaching your API — configure this per your CDN's edge-caching rules; (2) your CDN's geo header (`CF-IPCountry`, `X-Vercel-IP-Country`, or equivalent) is what populates the `country` field in analytics — set the header name expected in [`url.controller.ts`](src/rest/controllers/url.controller.ts) to match your actual CDN provider.
- **Database connection pooling**: `PG_POOL_MAX` caps connections per instance — as you add API/worker replicas, make sure `replicas × PG_POOL_MAX` stays under your Postgres server's `max_connections`, or put a connection pooler (PgBouncer) in front of Postgres.

---

## Design decisions & trade-offs

- **Redis list as a queue, not Kafka/RabbitMQ** — simpler to run locally and sufficient for this scale of project. It's an at-least-once-ish, single-consumer-group queue: acceptable for analytics (losing an occasional click event under a Redis outage is a fine trade-off), not acceptable for anything that needs durability guarantees. See Roadmap.
- **No ORM** — raw parameterized SQL in `models/`. At this project's core (a handful of tables, performance-sensitive queries), an ORM's abstraction cost isn't worth it, and hand-written SQL keeps the indexing story in the README honest and verifiable.
- **Short codes generated randomly, not sequentially encoded from an auto-increment ID.** A sequential ID-to-base62 scheme (like some real short-URL systems use) makes URLs guessable/enumerable, leaking your total link volume and letting anyone iterate every link on the platform. Random generation costs a possible (rare, atomically handled) collision retry in exchange for non-enumerability.
- **IP hashing instead of raw storage** — enough utility for rough analytics without holding onto raw client IPs.

---

## Roadmap

Ideas for extending this beyond the current implementation:

- [ ] Swap the Redis-list queue for Kafka when you need durable, replayable click events across multiple downstream consumers (analytics, fraud detection, etc. — not just the one aggregator)
- [ ] Real GeoIP resolution (MaxMind GeoLite2) as a fallback for requests that arrive without a CDN geo header
- [ ] A small frontend dashboard (the `/api/analytics/:shortCode` and GraphQL `analytics` query are already dashboard-ready)
- [ ] Custom short codes/vanity URLs (`POST /api/urls` with a user-supplied `short_code`)
- [ ] API key auth for the creation/deletion endpoints instead of the current open `user_id` field

---

## License

MIT — use this however is useful to you.
