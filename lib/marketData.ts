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
