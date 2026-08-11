# Pressroom

A clean installable PWA that pulls news into one feed without requiring a paid news API.

## What is included

- Top, World, U.S., Business, Tech, Science, Sports and Culture feeds
- Broad publisher coverage through Google News RSS search feeds
- Custom RSS feed support
- Search
- Source filtering
- Saved articles (stored locally on the device)
- Offline app shell + cached last-loaded feeds
- Reader view
- Full article body **when the publisher/feed itself includes it**
- Publisher link when only a title/summary is syndicated
- Light/dark mode and compact mode
- PWA install support
- No API keys

## Folder layout

- `/index.html`, `/app.js`, `/styles.css`, `/sw.js` — frontend PWA
- `/worker` — Cloudflare Worker that fetches and normalizes RSS/Atom feeds

## 1. Deploy the backend Worker

You need Node.js installed locally, or you can do this in GitHub Codespaces.

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

Wrangler will print a URL similar to:

```text
https://pressroom-news.YOUR-SUBDOMAIN.workers.dev
```

Copy it.

## 2. Deploy the PWA

The frontend is static, so GitHub Pages works well.

1. Put the frontend files in your GitHub repository.
2. Enable GitHub Pages for the repository.
3. Open the deployed Pressroom site.
4. Tap/click the gear.
5. Paste the Worker URL into **Backend URL**.
6. Save.

The backend URL is stored in localStorage on that device.

## 3. Add your own sources

Open Settings and add RSS/Atom URLs, one per line. They show under **My Feeds**.

Examples of the kinds of feeds Pressroom understands:

```text
https://feeds.bbci.co.uk/news/rss.xml
https://example.com/rss.xml
https://example.com/atom.xml
```

## Full articles

Pressroom deliberately does not include a paywall bypass or a generic “copy the entire publisher page” scraper.

If an RSS/Atom item contains `content:encoded` or an Atom `content` body, Pressroom can show that body in its reader. If the publisher only syndicates a headline/summary, the reader shows the available preview and preserves a direct “Read at source” link.

That keeps the app useful without turning it into a publisher-content republishing scraper.

## Local development

Frontend:

```bash
python -m http.server 8080
```

Worker:

```bash
cd worker
npx wrangler dev
```

Then enter `http://localhost:8787` as the Backend URL in Pressroom Settings.

## Easy next upgrades

The current code is structured so you can add:

- account sync via Supabase
- push notifications for followed topics
- per-source mute/favorite controls
- local Rhode Island / Boston feeds
- story clustering (“12 sources covering the same story”)
- political/source-balance indicators
- AI summaries (using your own backend model key)
- keyword alerts
- a “Morning Brief” page
- source folders
- reading history
- text size/font controls
