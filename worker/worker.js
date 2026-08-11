const GOOGLE_BASE = "https://news.google.com/rss";
const GOOGLE_PARAMS = "hl=en-US&gl=US&ceid=US:en";
const BBC_TOP = "https://feeds.bbci.co.uk/news/rss.xml";

const CATEGORY_QUERIES = {
  top: null,
  world: "world news",
  us: "United States news",
  business: "business economy markets",
  technology: "technology software AI computing",
  science: "science space research",
  sports: "sports",
  culture: "culture movies music books art",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname === "/" || url.pathname === "/health") {
        return json({ ok: true, service: "Pressroom feed proxy" }, 200, cors);
      }

      if (url.pathname === "/news") {
        const category = url.searchParams.get("category") || "top";
        const query = CATEGORY_QUERIES[category];
        if (!(category in CATEGORY_QUERIES)) return json({ error: "Unknown category" }, 400, cors);
        const feedUrl = query
          ? `${GOOGLE_BASE}/search?q=${encodeURIComponent(query)}&${GOOGLE_PARAMS}`
          : `${GOOGLE_BASE}?${GOOGLE_PARAMS}`;
        const data = await getFeed(feedUrl, request, url.searchParams.has("fresh"));
        return json(data, 200, cors);
      }

      if (url.pathname === "/search") {
        const q = (url.searchParams.get("q") || "").trim();
        if (!q) return json({ items: [] }, 200, cors);
        const feedUrl = `${GOOGLE_BASE}/search?q=${encodeURIComponent(q)}&${GOOGLE_PARAMS}`;
        const data = await getFeed(feedUrl, request, url.searchParams.has("fresh"));
        return json(data, 200, cors);
      }

      if (url.pathname === "/feed") {
        const feedUrl = url.searchParams.get("url");
        if (!feedUrl || !isSafePublicUrl(feedUrl)) return json({ error: "Invalid feed URL" }, 400, cors);
        const data = await getFeed(feedUrl, request, url.searchParams.has("fresh"));
        return json(data, 200, cors);
      }

      if (url.pathname === "/bbc") {
        const data = await getFeed(BBC_TOP, request, url.searchParams.has("fresh"));
        return json(data, 200, cors);
      }

      return json({ error: "Not found" }, 404, cors);
    } catch (error) {
      return json({ error: error?.message || "Feed request failed" }, 502, cors);
    }
  },
};

async function getFeed(feedUrl, request, forceFresh = false) {
  const cache = caches.default;
  const cacheKey = new Request(`https://pressroom-cache.local/feed?url=${encodeURIComponent(feedUrl)}`);
  if (!forceFresh) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached.json();
  }

  const response = await fetch(feedUrl, {
    headers: {
      "User-Agent": "PressroomRSS/1.0 (+personal RSS reader)",
      "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.7",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Source returned ${response.status}`);
  const xml = await response.text();
  const data = parseFeed(xml, feedUrl);
  const cacheResponse = new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
  });
  await cache.put(cacheKey, cacheResponse.clone());
  return data;
}

function parseFeed(xml, feedUrl) {
  const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blocks = isAtom ? matchBlocks(xml, "entry") : matchBlocks(xml, "item");
  const feedTitle = decodeXml(extractTag(xml, "title")) || hostname(feedUrl);
  const items = blocks.slice(0, 80).map((block) => parseItem(block, feedUrl, feedTitle, isAtom)).filter((x) => x.title && x.url);
  return { title: feedTitle, sourceUrl: feedUrl, fetchedAt: new Date().toISOString(), items };
}

function parseItem(block, feedUrl, feedTitle, atom = false) {
  const title = clean(extractTag(block, "title"));
  const link = atom ? extractAtomLink(block) : decodeXml(extractTag(block, "link"));
  const guid = clean(extractTag(block, "guid")) || link || title;
  const source = clean(extractTag(block, "source")) || inferGoogleSource(title) || feedTitle || hostname(link || feedUrl);
  const publishedAt = clean(extractTag(block, "pubDate")) || clean(extractTag(block, "published")) || clean(extractTag(block, "updated")) || new Date().toISOString();
  const author = clean(extractTag(block, "dc:creator")) || clean(extractTag(block, "author"));
  const fullContent = extractTagRaw(block, "content:encoded") || (!atom ? "" : extractTagRaw(block, "content"));
  const descriptionRaw = extractTagRaw(block, atom ? "summary" : "description");
  const description = stripHtml(descriptionRaw).replace(/\s+/g, " ").trim();
  const image = extractImage(block, descriptionRaw);
  const cleanTitle = title.replace(/\s+-\s+[^-]+$/, (suffix) => source && suffix.toLowerCase().includes(source.toLowerCase()) ? "" : suffix).trim();

  return {
    id: simpleHash(guid),
    title: cleanTitle || title,
    description: description.slice(0, 500),
    fullContent: fullContent ? sanitizeFeedHtml(fullContent) : "",
    url: link,
    source,
    author,
    image,
    publishedAt: safeDate(publishedAt),
  };
}

function matchBlocks(xml, tag) {
  const re = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>[\\s\\S]*?<\\/${escapeRegExp(tag)}>`, "gi");
  return xml.match(re) || [];
}

function extractTag(xml, tag) {
  return stripCdata(extractTagRaw(xml, tag));
}

function extractTagRaw(xml, tag) {
  const re = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, "i");
  return xml.match(re)?.[1]?.trim() || "";
}

function extractAtomLink(block) {
  const alternate = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  const any = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  return decodeXml(alternate || any || "");
}

function extractImage(block, descriptionRaw = "") {
  const candidates = [
    block.match(/<media:content\b[^>]*url=["']([^"']+)["']/i)?.[1],
    block.match(/<media:thumbnail\b[^>]*url=["']([^"']+)["']/i)?.[1],
    block.match(/<enclosure\b[^>]*type=["']image\/[^"']+["'][^>]*url=["']([^"']+)["']/i)?.[1],
    block.match(/<enclosure\b[^>]*url=["']([^"']+)["'][^>]*type=["']image\/[^"']+["']/i)?.[1],
    descriptionRaw.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1],
  ].filter(Boolean);
  return decodeXml(candidates[0] || "");
}

function inferGoogleSource(title) {
  const parts = clean(title).split(" - ");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function sanitizeFeedHtml(html) {
  return stripCdata(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*(["']).*?\1/gi, "")
    .replace(/javascript:/gi, "")
    .slice(0, 120000);
}

function stripHtml(html = "") {
  return decodeXml(stripCdata(html).replace(/<[^>]+>/g, " "));
}
function stripCdata(value = "") { return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, ""); }
function clean(value = "") { return decodeXml(stripHtml(value)).replace(/\s+/g, " ").trim(); }
function decodeXml(value = "") {
  return String(value)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
function hostname(value) { try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; } }
function safeDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(); }
function simpleHash(value) { let h = 2166136261; for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function isSafePublicUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "0.0.0.0" || host === "::1" || host.endsWith(".local")) return false;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
    const match172 = host.match(/^172\.(\d+)\./);
    if (match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31) return false;
    return true;
  } catch { return false; }
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
  });
}
