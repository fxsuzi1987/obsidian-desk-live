import { Redis } from "@upstash/redis";
import type { CycleState, PaperPortfolio, JournalEntry, LogEntry } from "./types";
import { PAPER_STARTING_EQUITY } from "./config";

const STATE_KEY = "obsidian:latest_cycle";
const PORTFOLIO_KEY = "obsidian:portfolio";
const JOURNAL_KEY = "obsidian:journal"; // list, newest first
const LOGS_KEY = "obsidian:logs"; // list, newest first
const MAX_JOURNAL = 200;
const MAX_LOGS = 300;

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
