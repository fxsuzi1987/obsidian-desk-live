import { Redis } from "@upstash/redis";
import type { CycleState, PaperPortfolio, JournalEntry, LogEntry } from "./types";
import { PAPER_STARTING_EQUITY } from "./config";

const STATE_KEY = "obsidian:latest_cycle";
const PORTFOLIO_KEY = "obsidian:portfolio";
const JOURNAL_KEY = "obsidian:journal"; // list, newest first
const LOGS_KEY = "obsidian:logs"; // list, newest first
const MAX_JOURNAL = 200;
const MAX_LOGS = 300;

const HISTORY_CACHE_KEY = "obsidian:gold_history_cache";
const NEWS_CACHE_KEY = "obsidian:gold_news_cache";
// Gold history comes from a free tier capped at 100 requests/month (~3/day),
// so cache it for most of a day. News comes from a free tier capped by
// requests/minute, not/day, so a short cache just avoids hammering it every
// 10-minute cycle for no reason.
const HISTORY_TTL_SECONDS = 22 * 60 * 60;
const NEWS_TTL_SECONDS = 20 * 60;

let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

// In-memory fallback so the app runs (single instance, e.g. `next dev` or a
// server that keeps a warm process) even before Upstash is configured.
// On real serverless deployments this resets between cold starts — set
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN for real persistence.
const mem: {
  state: CycleState | null;
  portfolio: PaperPortfolio;
  journal: JournalEntry[];
  logs: LogEntry[];
} = {
  state: null,
  portfolio: {
    startingEquity: PAPER_STARTING_EQUITY,
    cash: PAPER_STARTING_EQUITY,
    realizedPnl: 0,
    position: null,
    peakEquity: PAPER_STARTING_EQUITY,
  },
  journal: [],
  logs: [],
};

export async function usingPersistentStore(): Promise<boolean> {
  return getRedis() !== null;
}

export async function loadPortfolio(): Promise<PaperPortfolio> {
  const r = getRedis();
  if (!r) return mem.portfolio;
  const v = await r.get<PaperPortfolio>(PORTFOLIO_KEY);
  return (
    v ?? {
      startingEquity: PAPER_STARTING_EQUITY,
      cash: PAPER_STARTING_EQUITY,
      realizedPnl: 0,
      position: null,
      peakEquity: PAPER_STARTING_EQUITY,
    }
  );
}

export async function savePortfolio(p: PaperPortfolio): Promise<void> {
  const r = getRedis();
  if (!r) {
    mem.portfolio = p;
    return;
  }
  await r.set(PORTFOLIO_KEY, p);
}

export async function saveLatestState(state: CycleState): Promise<void> {
  const r = getRedis();
  if (!r) {
    mem.state = state;
    return;
  }
  await r.set(STATE_KEY, state);
}

export async function loadLatestState(): Promise<CycleState | null> {
  const r = getRedis();
  if (!r) return mem.state;
  return (await r.get<CycleState>(STATE_KEY)) ?? null;
}

export async function pushJournalEntry(entry: JournalEntry): Promise<void> {
  const r = getRedis();
  if (!r) {
    mem.journal.unshift(entry);
    mem.journal = mem.journal.slice(0, MAX_JOURNAL);
    return;
  }
  await r.lpush(JOURNAL_KEY, JSON.stringify(entry));
  await r.ltrim(JOURNAL_KEY, 0, MAX_JOURNAL - 1);
}

export async function loadJournal(limit = 50): Promise<JournalEntry[]> {
  const r = getRedis();
  if (!r) return mem.journal.slice(0, limit);
  const raw = await r.lrange<string>(JOURNAL_KEY, 0, limit - 1);
  return raw.map((s) => (typeof s === "string" ? JSON.parse(s) : s));
}

export async function pushLogs(entries: LogEntry[]): Promise<void> {
  const r = getRedis();
  if (!r) {
    mem.logs.unshift(...entries.slice().reverse());
    mem.logs = mem.logs.slice(0, MAX_LOGS);
    return;
  }
  if (entries.length === 0) return;
  await r.lpush(LOGS_KEY, ...entries.slice().reverse().map((e) => JSON.stringify(e)));
  await r.ltrim(LOGS_KEY, 0, MAX_LOGS - 1);
}

export async function loadLogs(limit = 50): Promise<LogEntry[]> {
  const r = getRedis();
  if (!r) return mem.logs.slice(0, limit);
  const raw = await r.lrange<string>(LOGS_KEY, 0, limit - 1);
  return raw.map((s) => (typeof s === "string" ? JSON.parse(s) : s));
}

// In-memory fallback cache for getCachedOrFetch, used when Redis isn't
// configured (see the persistent-store note above — same tradeoff applies).
let memHistoryCache: { data: unknown; expiresAt: number } | null = null;
let memNewsCache: { data: unknown; expiresAt: number } | null = null;

/**
 * Shared cache wrapper for the two rate-limited external feeds (gold price
 * history, gold-relevant news). Serves a cached value when one exists and
 * hasn't expired; otherwise calls `fetcher`, caches the result, and returns
 * it. A thrown error from `fetcher` is never cached, so a transient failure
 * (or a missing API key) doesn't poison the cache — the next call just
 * tries again.
 */
export async function getCachedOrFetch<T>(kind: "history" | "news", fetcher: () => Promise<T>): Promise<T> {
  const key = kind === "history" ? HISTORY_CACHE_KEY : NEWS_CACHE_KEY;
  const ttlSeconds = kind === "history" ? HISTORY_TTL_SECONDS : NEWS_TTL_SECONDS;

  const r = getRedis();
  if (r) {
    const cached = await r.get<T>(key);
    if (cached !== null && cached !== undefined) return cached;
    const fresh = await fetcher();
    await r.set(key, fresh as unknown as Record<string, unknown>, { ex: ttlSeconds });
    return fresh;
  }

  const existing = kind === "history" ? memHistoryCache : memNewsCache;
  if (existing && existing.expiresAt > Date.now()) return existing.data as T;
  const fresh = await fetcher();
  const entry = { data: fresh as unknown, expiresAt: Date.now() + ttlSeconds * 1000 };
  if (kind === "history") memHistoryCache = entry;
  else memNewsCache = entry;
  return fresh;
}
