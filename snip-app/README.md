# Snip

A client-side URL shortener and click-analytics dashboard. Data is stored in
your browser's localStorage — there's no server, so links only work on the
device/browser where they were created.

## Run it locally

```
npm install
npm run dev
```

## Deploy to GitHub Pages

1. Push this project to a GitHub repo.
2. In the repo, go to **Settings → Pages** and set **Source** to
   **GitHub Actions**.
3. Push to `main` — the included workflow
   (`.github/workflows/deploy.yml`) builds the app and deploys it
   automatically. Your site will be live at
   `https://<username>.github.io/<repo-name>/`.

## Connecting it to a real backend

This currently simulates the backend described in the original repo
(cache-aside redirects, async click analytics) entirely in the browser.
To wire it up to a real deployed API instead:

- Replace the calls to `storage.get` / `storage.set` in `src/App.jsx`
  with `fetch` calls to your API's `/api/urls` and
  `/api/analytics/:shortCode` endpoints.
- Deploy the backend (Postgres + Redis + API + worker) somewhere that
  runs containers — Render, Railway, and Fly.io all support the
  `docker-compose.yml` setup with minimal changes. GitHub Pages only
  serves static files, so the backend has to live elsewhere.
