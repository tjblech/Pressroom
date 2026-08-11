const DEFAULT_SETTINGS = {
  apiBase: "",
  customFeeds: [],
  compact: false,
  dark: window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false,
};

const CATEGORY_LABELS = {
  top: ["TOP STORIES", "Today"],
  world: ["WORLD", "Around the world"],
  us: ["UNITED STATES", "Across the U.S."],
  business: ["BUSINESS", "Business & markets"],
  technology: ["TECHNOLOGY", "Technology"],
  science: ["SCIENCE", "Science"],
  sports: ["SPORTS", "Sports"],
  culture: ["CULTURE", "Culture"],
  custom: ["MY FEEDS", "Your sources"],
  saved: ["LIBRARY", "Saved articles"],
  search: ["SEARCH", "Search results"],
};

let settings = loadJSON("pressroom.settings", DEFAULT_SETTINGS);
let saved = loadJSON("pressroom.saved", []);
let currentCategory = "top";
let currentItems = [];
let currentSource = "All";
let currentReaderItem = null;
let deferredInstallPrompt = null;

const $ = (selector) => document.querySelector(selector);
const els = {
  feedGrid: $("#feedGrid"),
  heroSection: $("#heroSection"),
  articleTemplate: $("#articleTemplate"),
  sourceFilter: $("#sourceFilter"),
  articleCount: $("#articleCount"),
  emptyState: $("#emptyState"),
  emptyText: $("#emptyText"),
  feedEyebrow: $("#feedEyebrow"),
  feedTitle: $("#feedTitle"),
  readerDialog: $("#readerDialog"),
  readerBody: $("#readerBody"),
  saveReader: $("#saveReader"),
  settingsDialog: $("#settingsDialog"),
  apiBaseInput: $("#apiBaseInput"),
  customFeedsInput: $("#customFeedsInput"),
  compactToggle: $("#compactToggle"),
  darkToggle: $("#darkToggle"),
  searchPanel: $("#searchPanel"),
  searchInput: $("#searchInput"),
};

init();

function init() {
  applySettings();
  bindEvents();
  registerServiceWorker();
  loadCategory("top");
}

function bindEvents() {
  $("#categoryStrip").addEventListener("click", (event) => {
    const button = event.target.closest(".category");
    if (!button) return;
    document.querySelectorAll(".category").forEach((el) => el.classList.toggle("active", el === button));
    currentCategory = button.dataset.category;
    currentSource = "All";
    loadCategory(currentCategory);
  });

  $("#refreshButton").addEventListener("click", () => loadCategory(currentCategory, { force: true }));
  $("#brandButton").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  $("#searchToggle").addEventListener("click", () => {
    els.searchPanel.classList.toggle("hidden");
    if (!els.searchPanel.classList.contains("hidden")) setTimeout(() => els.searchInput.focus(), 0);
  });

  $("#searchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = els.searchInput.value.trim();
    if (!query) return;
    await searchNews(query);
  });

  $("#savedToggle").addEventListener("click", showSaved);
  $("#settingsToggle").addEventListener("click", openSettings);
  $("#closeReader").addEventListener("click", () => els.readerDialog.close());
  $("#saveReader").addEventListener("click", () => currentReaderItem && toggleSaved(currentReaderItem));
  $("#shareReader").addEventListener("click", shareCurrentArticle);

  $("#settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    settings.apiBase = normalizeApiBase(els.apiBaseInput.value);
    settings.customFeeds = els.customFeedsInput.value.split("\n").map((x) => x.trim()).filter(Boolean);
    settings.compact = els.compactToggle.checked;
    settings.dark = els.darkToggle.checked;
    saveJSON("pressroom.settings", settings);
    applySettings();
    els.settingsDialog.close();
    loadCategory(currentCategory, { force: true });
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $("#installButton").disabled = false;
  });

  $("#installButton").addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      alert("Use your browser's ‘Add to Home Screen’ / ‘Install app’ option if the install prompt is not available yet.");
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });
}

async function loadCategory(category, { force = false } = {}) {
  setHeading(category);
  showLoading();

  if (category === "custom") {
    if (!settings.customFeeds.length) {
      renderItems([]);
      els.emptyText.textContent = "Add RSS feed URLs in Settings, then come back here.";
      return;
    }
    if (!ensureBackend()) return;
    try {
      const batches = await Promise.all(settings.customFeeds.map((feed) => fetchJSON(`${settings.apiBase}/feed?url=${encodeURIComponent(feed)}${force ? "&fresh=1" : ""}`)));
      currentItems = normalizeItems(batches.flatMap((batch) => batch.items || []));
      cacheCategory(category, currentItems);
      renderItems(currentItems);
    } catch (error) {
      handleLoadError(error, category);
    }
    return;
  }

  if (!settings.apiBase) {
    const cached = getCachedCategory(category);
    if (cached.length) {
      currentItems = cached;
      renderItems(currentItems);
      return;
    }
    renderItems([]);
    els.emptyText.textContent = "Open Settings and add the URL of the included backend Worker to start loading live news.";
    return;
  }

  try {
    const data = await fetchJSON(`${settings.apiBase}/news?category=${encodeURIComponent(category)}${force ? "&fresh=1" : ""}`);
    currentItems = normalizeItems(data.items || []);
    cacheCategory(category, currentItems);
    renderItems(currentItems);
  } catch (error) {
    handleLoadError(error, category);
  }
}

async function searchNews(query) {
  setHeading("search", query);
  showLoading();
  currentCategory = "search";
  currentSource = "All";
  if (!ensureBackend()) return;
  try {
    const data = await fetchJSON(`${settings.apiBase}/search?q=${encodeURIComponent(query)}`);
    currentItems = normalizeItems(data.items || []);
    renderItems(currentItems);
  } catch (error) {
    handleLoadError(error, "search");
  }
}

function showSaved() {
  currentCategory = "saved";
  currentSource = "All";
  setHeading("saved");
  currentItems = normalizeItems(saved);
  renderItems(currentItems);
  document.querySelectorAll(".category").forEach((el) => el.classList.remove("active"));
}

function renderItems(items) {
  const filtered = currentSource === "All" ? items : items.filter((item) => item.source === currentSource);
  els.feedGrid.innerHTML = "";
  els.heroSection.innerHTML = "";
  els.emptyState.classList.toggle("hidden", filtered.length > 0);
  els.articleCount.textContent = filtered.length ? `${filtered.length} stories` : "";

  buildSourceFilter(items);
  if (!filtered.length) return;

  const [hero, ...rest] = filtered;
  if (!settings.compact && hero) els.heroSection.appendChild(buildHero(hero));
  const cardItems = settings.compact ? filtered : rest;
  cardItems.forEach((item) => els.feedGrid.appendChild(buildCard(item)));
}

function buildHero(item) {
  const wrap = document.createElement("article");
  wrap.className = "hero-story";
  const media = document.createElement("div");
  media.className = "hero-media";
  const img = document.createElement("img");
  img.src = item.image || fallbackImage(item.source);
  img.alt = "";
  img.loading = "eager";
  media.appendChild(img);

  const copy = document.createElement("div");
  copy.className = "hero-copy";
  const button = document.createElement("button");
  button.innerHTML = `<div class="hero-meta"><span>${escapeHTML(item.source)}</span><span>•</span><span>${escapeHTML(relativeTime(item.publishedAt))}</span></div><h2>${escapeHTML(item.title)}</h2><p>${escapeHTML(item.description || "Open the story for more.")}</p>`;
  button.addEventListener("click", () => openReader(item));
  copy.appendChild(button);
  wrap.append(media, copy);
  return wrap;
}

function buildCard(item) {
  const node = els.articleTemplate.content.cloneNode(true);
  const card = node.querySelector(".story-card");
  const open = node.querySelector(".story-open");
  const image = node.querySelector(".story-image");
  const source = node.querySelector(".story-source");
  const time = node.querySelector(".story-time");
  const title = node.querySelector(".story-title");
  const description = node.querySelector(".story-description");
  const saveButton = node.querySelector(".save-button");

  image.src = item.image || fallbackImage(item.source);
  image.onerror = () => { image.src = fallbackImage(item.source); };
  source.textContent = item.source;
  time.textContent = relativeTime(item.publishedAt);
  title.textContent = item.title;
  description.textContent = item.description || "";
  saveButton.classList.toggle("saved", isSaved(item));
  saveButton.textContent = isSaved(item) ? "★" : "☆";

  open.addEventListener("click", () => openReader(item));
  saveButton.addEventListener("click", () => toggleSaved(item, saveButton));
  card.dataset.id = item.id;
  return node;
}

function buildSourceFilter(items) {
  const sources = [...new Set(items.map((x) => x.source).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  els.sourceFilter.innerHTML = "";
  if (sources.length < 2) {
    els.sourceFilter.classList.add("hidden");
    return;
  }
  els.sourceFilter.classList.remove("hidden");
  ["All", ...sources].forEach((source) => {
    const button = document.createElement("button");
    button.className = `source-pill${currentSource === source ? " active" : ""}`;
    button.textContent = source;
    button.addEventListener("click", () => {
      currentSource = source;
      renderItems(currentItems);
    });
    els.sourceFilter.appendChild(button);
  });
}

function openReader(item) {
  currentReaderItem = item;
  els.readerBody.innerHTML = "";

  const source = document.createElement("div");
  source.className = "reader-source";
  source.textContent = item.source;

  const title = document.createElement("h1");
  title.textContent = item.title;

  const byline = document.createElement("div");
  byline.className = "reader-byline";
  byline.textContent = `${item.author ? `${item.author} · ` : ""}${formatDate(item.publishedAt)}`;

  els.readerBody.append(source, title, byline);

  if (item.image) {
    const img = document.createElement("img");
    img.className = "reader-hero";
    img.src = item.image;
    img.alt = "";
    els.readerBody.appendChild(img);
  }

  const content = document.createElement("div");
  content.className = "reader-content";
  if (item.fullContent) {
    content.append(...safeArticleNodes(item.fullContent));
  } else if (item.description) {
    const p = document.createElement("p");
    p.textContent = item.description;
    content.appendChild(p);
  }
  els.readerBody.appendChild(content);

  const notice = document.createElement("div");
  notice.className = "reader-notice";
  notice.textContent = item.fullContent
    ? "This source included article content in its feed, so Pressroom can display it here."
    : "This feed did not include the full story. Pressroom keeps the source link intact instead of copying or bypassing publisher access controls.";
  els.readerBody.appendChild(notice);

  const link = document.createElement("a");
  link.className = "source-link";
  link.href = item.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `Read at ${item.source || "source"} ↗`;
  els.readerBody.appendChild(link);

  els.saveReader.textContent = isSaved(item) ? "★" : "☆";
  els.readerDialog.showModal();
}

function safeArticleNodes(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  root.querySelectorAll("script,style,iframe,object,embed,form,button,input,textarea,svg,canvas").forEach((el) => el.remove());
  root.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (attr.name.startsWith("on") || ["style", "srcset"].includes(attr.name)) el.removeAttribute(attr.name);
      if (["href", "src"].includes(attr.name) && /^javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    });
  });
  return [...root.childNodes].map((node) => document.importNode(node, true));
}

function toggleSaved(item, button) {
  const index = saved.findIndex((x) => x.id === item.id);
  if (index >= 0) saved.splice(index, 1);
  else saved.unshift(item);
  saveJSON("pressroom.saved", saved.slice(0, 500));
  const nowSaved = isSaved(item);
  if (button) {
    button.classList.toggle("saved", nowSaved);
    button.textContent = nowSaved ? "★" : "☆";
  }
  if (currentReaderItem?.id === item.id) els.saveReader.textContent = nowSaved ? "★" : "☆";
  if (currentCategory === "saved") {
    currentItems = normalizeItems(saved);
    renderItems(currentItems);
  }
}

async function shareCurrentArticle() {
  if (!currentReaderItem) return;
  const payload = { title: currentReaderItem.title, text: currentReaderItem.description || currentReaderItem.title, url: currentReaderItem.url };
  try {
    if (navigator.share) await navigator.share(payload);
    else {
      await navigator.clipboard.writeText(currentReaderItem.url);
      alert("Article link copied.");
    }
  } catch {}
}

function normalizeItems(items) {
  const seen = new Set();
  return items
    .map((item) => ({
      id: item.id || hash(`${item.url}|${item.title}`),
      title: cleanText(item.title),
      description: cleanText(item.description),
      fullContent: item.fullContent || "",
      url: item.url || "#",
      source: cleanText(item.source) || hostname(item.url) || "Unknown source",
      author: cleanText(item.author),
      image: item.image || "",
      publishedAt: item.publishedAt || new Date().toISOString(),
    }))
    .filter((item) => item.title && item.url && !seen.has(item.id) && seen.add(item.id))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

function setHeading(category, overrideTitle = "") {
  const [eyebrow, title] = CATEGORY_LABELS[category] || CATEGORY_LABELS.top;
  els.feedEyebrow.textContent = eyebrow;
  els.feedTitle.textContent = overrideTitle || title;
}

function showLoading() {
  els.emptyState.classList.add("hidden");
  els.sourceFilter.classList.add("hidden");
  els.heroSection.innerHTML = "";
  els.feedGrid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join("");
  els.articleCount.textContent = "Loading…";
}

function handleLoadError(error, category) {
  console.error(error);
  const cached = getCachedCategory(category);
  if (cached.length) {
    currentItems = cached;
    renderItems(currentItems);
    els.articleCount.textContent += " · offline copy";
    return;
  }
  renderItems([]);
  els.emptyText.textContent = `Couldn’t load the feed. ${error.message || "Check your backend URL and connection."}`;
}

function ensureBackend() {
  if (settings.apiBase) return true;
  renderItems([]);
  els.emptyText.textContent = "Add your deployed Worker URL in Settings first.";
  openSettings();
  return false;
}

function openSettings() {
  els.apiBaseInput.value = settings.apiBase || "";
  els.customFeedsInput.value = settings.customFeeds.join("\n");
  els.compactToggle.checked = settings.compact;
  els.darkToggle.checked = settings.dark;
  els.settingsDialog.showModal();
}

function applySettings() {
  document.documentElement.classList.toggle("dark", !!settings.dark);
  document.body.classList.toggle("compact", !!settings.compact);
}

function cacheCategory(category, items) {
  saveJSON(`pressroom.cache.${category}`, { at: Date.now(), items: items.slice(0, 100) });
}

function getCachedCategory(category) {
  const cached = loadJSON(`pressroom.cache.${category}`, { items: [] });
  return normalizeItems(cached.items || []);
}

function isSaved(item) { return saved.some((x) => x.id === item.id); }
function normalizeApiBase(value) { return value.trim().replace(/\/+$/, ""); }
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return Array.isArray(fallback) ? [...fallback] : { ...fallback };
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : [...fallback];
    return parsed && typeof parsed === "object" ? { ...fallback, ...parsed } : { ...fallback };
  } catch {
    return Array.isArray(fallback) ? [...fallback] : { ...fallback };
  }
}
function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

async function fetchJSON(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Backend returned ${response.status}.`);
  return response.json();
}

function cleanText(value = "") {
  const doc = new DOMParser().parseFromString(String(value), "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}
function hostname(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
function escapeHTML(value = "") { return String(value).replace(/[&<>'"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c])); }
function hash(value) { let h = 2166136261; for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function fallbackImage(source = "") {
  const initials = source.split(/\s+/).slice(0,2).map((x) => x[0]).join("").toUpperCase() || "P";
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="100%" height="100%" fill="#dad7d0"/><text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" fill="#555" font-family="Georgia" font-size="100" font-weight="700">${initials}</text></svg>`)}`;
}
function relativeTime(date) {
  const delta = Date.now() - new Date(date).getTime();
  if (!Number.isFinite(delta)) return "";
  const minutes = Math.max(1, Math.floor(delta / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
function formatDate(date) {
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(new Date(date)); }
  catch { return date || ""; }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try { await navigator.serviceWorker.register("./sw.js"); } catch (error) { console.warn("Service worker registration failed", error); }
}
