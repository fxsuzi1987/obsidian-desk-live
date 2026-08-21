import type { GoldPriceSnapshot } from "./types";

// Free, keyless gold spot price endpoint. Verified endpoint shape (Aug 2026):
// GET https://api.gold-api.com/price/XAU/USD
// -> { "currency": "USD", "price": 4165.20, "symbol": "XAU", "updatedAt": "..." }
const GOLD_API_URL = "https://api.gold-api.com/price/XAU/USD";

export async function fetchGoldPrice(): Promise<GoldPriceSnapshot> {
  const res = await fetch(GOLD_API_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`gold-api.com returned ${res.status}`);
  }
  const data = (await res.json()) as { price: number; currency: string; updatedAt: string };
  if (typeof data.price !== "number" || !Number.isFinite(data.price)) {
    throw new Error("gold-api.com returned an unexpected payload shape");
  }
  return {
    price: data.price,
    currency: data.currency || "USD",
    updatedAt: data.updatedAt || new Date().toISOString(),
    source: "gold-api.com",
  };
}

// ---------------------------------------------------------------------------
// Historical price feed (for the Technical Agent).
//
// Free tier: https://metalpriceapi.com — 100 requests/month, no card needed.
// That's roughly 3/day, so the caller MUST cache this aggressively (see
// getCachedOrFetch in store.ts, used from cycle.ts) rather than fetching it
// every 10-minute cycle.
// ---------------------------------------------------------------------------

export function hasMetalPriceKey(): boolean {
  return Boolean(process.env.METALPRICE_API_KEY);
}

export interface GoldHistoryPoint {
  date: string; // YYYY-MM-DD
  price: number; // USD per troy ounce
}

export async function fetchGoldHistory(days = 30): Promise<GoldHistoryPoint[]> {
  const apiKey = process.env.METALPRICE_API_KEY;
  if (!apiKey) throw new Error("METALPRICE_API_KEY is not set");

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const url = new URL("https://api.metalpriceapi.com/v1/timeframe");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("base", "USD");
  url.searchParams.set("currencies", "XAU");
  url.searchParams.set("start_date", fmt(start));
  url.searchParams.set("end_date", fmt(end));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`metalpriceapi.com returned ${res.status}`);
  }
  const data = (await res.json()) as {
    success?: boolean;
    rates?: Record<string, { USDXAU?: number }>;
    error?: unknown;
  };
  if (!data.success || !data.rates) {
    throw new Error(
      "metalpriceapi.com returned an unexpected payload" + (data.error ? `: ${JSON.stringify(data.error)}` : "")
    );
  }
  const points = Object.entries(data.rates)
    .map(([date, r]) => ({ date, price: r?.USDXAU }))
    .filter((p): p is GoldHistoryPoint => typeof p.price === "number" && Number.isFinite(p.price))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length === 0) {
    throw new Error("metalpriceapi.com returned no usable daily rates for the requested window");
  }
  return points;
}

export interface TechnicalStats {
  points: GoldHistoryPoint[];
  latestClose: number;
  change1d: number | null; // percent
  change5d: number | null;
  change20d: number | null;
  sma20: number | null;
  vsSma20Pct: number | null;
  volatilityPct: number | null; // stdev of daily returns, percent
  high20: number | null;
  low20: number | null;
}

/** Turns a plain list of daily closes into the summary stats the Technical
 * Agent reasons from. Returns null if there isn't enough history yet to say
 * anything meaningful (fewer than 2 points). */
export function computeTechnicalStats(points: GoldHistoryPoint[]): TechnicalStats | null {
  if (!points || points.length < 2) return null;
  const closes = points.map((p) => p.price);
  const latestClose = closes[closes.length - 1];

  const pctChangeBack = (nBack: number): number | null => {
    const idx = closes.length - 1 - nBack;
    if (idx < 0) return null;
    const base = closes[idx];
    if (!base) return null;
    return ((latestClose - base) / base) * 100;
  };

  const sma = (n: number): number | null => {
    const slice = closes.slice(-n);
    if (slice.length < Math.min(n, closes.length) || slice.length === 0) return null;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  };
  const sma20 = sma(Math.min(20, closes.length));

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1]) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  let volatilityPct: number | null = null;
  if (returns.length > 0) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
    volatilityPct = Math.sqrt(variance) * 100;
  }

  const window20 = closes.slice(-20);

  return {
    points,
    latestClose,
    change1d: pctChangeBack(1),
    change5d: pctChangeBack(5),
    change20d: pctChangeBack(Math.min(20, closes.length - 1)),
    sma20,
    vsSma20Pct: sma20 ? ((latestClose - sma20) / sma20) * 100 : null,
    volatilityPct,
    high20: window20.length ? Math.max(...window20) : null,
    low20: window20.length ? Math.min(...window20) : null,
  };
}

// ---------------------------------------------------------------------------
// News feed (for the News Agent).
//
// Free tier: https://finnhub.io — ~60 calls/minute, no card needed, personal
// use. We pull the general market news category and keyword-filter for
// gold/macro relevance ourselves, since the free tier doesn't offer a
// gold-specific news category.
// ---------------------------------------------------------------------------

export function hasFinnhubKey(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY);
}

export interface NewsHeadline {
  headline: string;
  summary: string;
  datetime: string; // ISO
  source: string;
  url: string;
}

const NEWS_KEYWORDS = [
  "gold",
  "xau",
  "fed",
  "fomc",
  "rate cut",
  "rate hike",
  "interest rate",
  "inflation",
  "cpi",
  "dollar",
  "treasury",
  "yield",
  "recession",
  "geopolit",
  "safe haven",
  "safe-haven",
  "central bank",
  "powell",
  "tariff",
];

export async function fetchGoldNews(limit = 8): Promise<NewsHeadline[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error("FINNHUB_API_KEY is not set");

  const url = new URL("https://finnhub.io/api/v1/news");
  url.searchParams.set("category", "general");
  url.searchParams.set("token", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`finnhub.io returned ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("finnhub.io returned an unexpected payload shape");
  }

  const relevant = data.filter((item) => {
    const text = `${item?.headline ?? ""} ${item?.summary ?? ""}`.toLowerCase();
    return NEWS_KEYWORDS.some((k) => text.includes(k));
  });
  // If nothing keyword-matched (a quiet news day), fall back to the top
  // general headlines rather than returning nothing — the News Agent is
  // told explicitly when headlines aren't clearly gold/macro relevant.
  const pool = relevant.length > 0 ? relevant : data;

  return pool.slice(0, limit).map((item) => ({
    headline: String(item?.headline ?? "Untitled"),
    summary: String(item?.summary ?? ""),
    datetime: typeof item?.datetime === "number" ? new Date(item.datetime * 1000).toISOString() : new Date().toISOString(),
    source: String(item?.source ?? "unknown"),
    url: String(item?.url ?? ""),
  }));
}

// Polymarket public Gamma API (no key required for reads).
// Base: https://gamma-api.polymarket.com
// This looks up open markets matching a keyword so the desk can surface
// whatever gold/Fed-adjacent markets currently exist, rather than a
// hard-coded market id that will go stale.
export interface PolymarketSummary {
  id: string;
  question: string;
  slug: string;
  outcomePrices: number[] | null;
  volume: number | null;
  endDate: string | null;
}

export async function searchPolymarketMarkets(keyword: string, limit = 5): Promise<PolymarketSummary[]> {
  const url = new URL("https://gamma-api.polymarket.com/markets");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order", "volume");
  url.searchParams.set("ascending", "false");
  url.searchParams.set("search", keyword);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`gamma-api.polymarket.com returned ${res.status}`);
  }
  const data = (await res.json()) as any[];
  return (Array.isArray(data) ? data : []).map((m) => {
    let outcomePrices: number[] | null = null;
    try {
      const parsed = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices;
      if (Array.isArray(parsed)) outcomePrices = parsed.map((p: string | number) => Number(p));
    } catch {
      outcomePrices = null;
    }
    return {
      id: String(m.id ?? m.conditionId ?? ""),
      question: String(m.question ?? "Untitled market"),
      slug: String(m.slug ?? ""),
      outcomePrices,
      volume: typeof m.volume === "number" ? m.volume : m.volume ? Number(m.volume) : null,
      endDate: m.endDate ?? null,
    };
  });
}
