# Obsidian Desk — Live (Stage 2)

This is the first *real* version of the Gold Desk agent pipeline. Unlike the
Stage 1 shell, the agents in here actually call Claude (and, optionally,
GPT) with real reasoning, against a real live gold price. What stays fully
simulated: **all trading**. There is no broker or exchange connection
anywhere in this codebase — "execution" only ever writes to a paper
portfolio object.

## What's real vs. simulated right now

| Piece | Status |
|---|---|
| Gold spot price | **Real** — [gold-api.com](https://gold-api.com), no key needed |
| Macro / Technical / News agents | **Real** Claude/GPT calls, reasoning honestly about their own data limits (no historical bars or news feed are wired in yet — they say so rather than making things up) |
| Bull / Bear / Skeptic debate | **Real** Claude/GPT calls |
| Judge | **Real** Claude call, defaults to NO_TRADE given the current data limits |
| Risk Engine | **Real deterministic code** — hard-coded limits, not agent-decided |
| Execution | **Simulated fill** into a paper portfolio — no broker |
| Position Monitor | **Real deterministic code**, watching the paper position against its stop/target on each cycle |
| Polymarket Desk, Strategy Lab, Evolution Lab, Portfolio Brain | Still the Stage 1 static mock (`Obsidian Desk/index.html` from before) — not wired to this live pipeline yet |

## Running it locally (optional — mainly for you to look at, not required)

```
npm install
cp .env.example .env.local   # then paste in your ANTHROPIC_API_KEY
npm run dev
```
Open the URL it prints. Click **Run cycle now**.

`npm run test:logic` runs a fast, no-network check of the risk engine and
paper-execution math (position sizing, stop/target math, blocking rules).
`npm run test:parser` checks the JSON-extraction logic against the exact
failure mode below. `npm run test:live` runs the full agent pipeline
against the real Anthropic API using your key — it costs a small fraction
of a cent and is the best way to confirm your key and model IDs actually
work before deploying. All three are worth running any time those files
change.

**A bug this already caught, for what it's worth:** the first real test run
showed the Judge model occasionally drafting an answer, catching itself
("wait, let me redo that"), and emitting a second corrected JSON object —
which broke a naive first-`{`-to-last-`}` parse. `lib/llm.ts`'s
`extractJSON` now scans for every balanced JSON object in the response and
tries them last-to-first, which is exactly the kind of thing you only find
by actually running it against a real model instead of guessing.

**On your API key:** treat `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` like
passwords — only ever put them in `.env.local` (already gitignored) or your
host's environment variable settings, never in a file you commit. If you
pasted a key into a chat at any point while setting this up, it's worth
rotating it (create a new one, delete the old one) in the provider's
console once you're done testing, just as a habit.

## Getting it actually live (continuous, no laptop required)

Three accounts, all free tier, all sign-in-with-existing-account — no new
passwords to invent:

1. **Anthropic API key** — console.anthropic.com → Get API Keys → Create
   Key. This is a pay-as-you-go key, separate from a Claude.ai
   subscription; a cycle every 10 minutes costs a small fraction of a cent
   per agent call.
2. **GitHub** — to hold the code. You very likely already have one.
3. **Vercel** (vercel.com) — sign in with GitHub, "Add New Project", import
   this repo. It builds and deploys automatically.
4. **Upstash** (console.upstash.com) — sign in with GitHub, Create Database
   → Redis → copy the REST URL and REST token. Without this, the app still
   runs but forgets its trade journal and portfolio every time the
   serverless function cold-starts.

Then in the Vercel project → Settings → Environment Variables, add:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (optional), `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN` — paste the values in, redeploy.

**Keeping it running continuously:** Vercel's free plan only allows a cron
job once a day, so `vercel.json` in here is set to once daily as a safety
net. The real heartbeat is `.github/workflows/run-cycle.yml` — a GitHub
Actions schedule that pings your deployed `/api/cycle` every 10 minutes,
for free. After you deploy, add one repo secret: Settings → Secrets and
variables → Actions → New repository secret → name it `DEPLOY_URL`, value
is your Vercel URL (e.g. `https://your-app.vercel.app`, no trailing
slash).

I can drive all of the clicking above myself, on your screen, with your
say-so at each step — just say the word and we'll do it together next.

## Honest limitations of this pass

- No historical price series yet, so the Technical Agent is intentionally
  low-confidence — it says so rather than inventing chart patterns.
- No live news feed, so the News Agent is intentionally low-confidence for
  the same reason.
- The event-blackout calendar (`lib/config.ts` → `EVENT_BLACKOUTS`) is an
  empty placeholder — populate it with real CPI/FOMC/NFP dates if you want
  the Risk Engine to actually enforce blackout windows.
- Position sizing and the default risk limits in `lib/config.ts` are
  starter numbers calibrated loosely against a $100,000 paper account —
  they're deliberately hard-coded so you can tune them directly, per the
  blueprint's own principle that risk limits are not something an agent
  decides.
