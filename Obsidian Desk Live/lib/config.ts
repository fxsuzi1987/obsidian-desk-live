// Deterministic configuration. Nothing in this file is decided by an LLM —
// that's the point: risk limits are hard-coded, not proposed by an agent.

// Starter defaults, calibrated for a $100,000 paper account trading spot
// gold (~$3,400/oz as of Aug 2026). Because one troy ounce is expensive,
// a $/stop-distance position size implies large notional fast — these
// numbers assume stops in the ~$15-30 range (roughly the size of a normal
// intraday move). Tune to your own risk appetite before treating this as
// anything but a demo: these are exactly the "hard-coded, not agent-decided"
// limits the blueprint calls for, so they're meant to be edited by you, not
// by an agent.
export const RISK_LIMITS = {
  maxRiskPerTradeDollars: 600, // ~0.6% of paper equity
  maxDailyLossDollars: 2500, // ~2.5% of paper equity
  maxDrawdownPct: 10,
  maxOpenExposureDollars: 150000, // 1.5x paper equity notional cap
  maxLeverage: 2.0,
};

export const PAPER_STARTING_EQUITY = 100000;

// CPI / FOMC / NFP blackout windows are illustrative placeholders — a real
// deployment should replace this with a real economic calendar feed.
// Format: UTC "HH:MM" windows on specific dates, checked against server time.
export const EVENT_BLACKOUTS: { label: string; startUtc: string; endUtc: string }[] = [
  // Example (disabled by default — populate with real dates before relying on it):
  // { label: "US CPI", startUtc: "2026-08-13T14:00:00Z", endUtc: "2026-08-13T15:00:00Z" },
];

// Model IDs current as of Aug 2026 (verified against platform.claude.com and
// developers.openai.com at build time). Both providers rename/rev models
// often — if a call starts failing with a "model not found" error, check
// https://platform.claude.com/docs/en/about-claude/models/overview and
// https://developers.openai.com/api/docs/models and update the strings below.
export const MODELS = {
  macro: "claude-sonnet-5",
  technical: "claude-sonnet-5",
  news: "gpt-5.6", // requires OPENAI_API_KEY; falls back to Claude if absent
  bull: "claude-sonnet-5",
  bear: "gpt-5.6", // requires OPENAI_API_KEY; falls back to Claude if absent
  skeptic: "claude-sonnet-5",
  judge: "claude-opus-5",
};
