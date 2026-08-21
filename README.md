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
| Gold spot price | **Real** — gold-api.com, no key needed |
| Macro / Technical / News agents | **Real** Claude/GPT calls, honest about their own data limits |
| Bull / Bear / Skeptic debate | **Real** Claude/GPT calls |
| Judge | **Real** Claude call, defaults to NO_TRADE given current data limits |
| Risk Engine | **Real deterministic code** — hard-coded limits, not agent-decided |
| Execution | **Simulated fill** into a paper portfolio — no broker |
| Position Monitor | **Real deterministic code**, watching stop/target each cycle |

## Running it locally (optional)

npm install then cp .env.example .env.local (paste in your ANTHROPIC_API_KEY) then npm run dev.
Open the URL it prints. Click Run cycle now.

npm run test:logic runs a fast, no-network check of the risk engine and
paper-execution math. npm run test:parser checks the JSON-extraction logic.
npm run test:live runs the full agent pipeline against the real Anthropic
API using your key.

## Getting it actually live (continuous, no laptop required)

- Anthropic API key at console.anthropic.com.
- - GitHub to hold the code (this repo).
  - - Vercel (vercel.com): sign in with GitHub, import this repo, deploy.
    - - Upstash (console.upstash.com): sign in with GitHub, create a Redis
      -   database, copy the REST URL and REST token into Vercel env vars.
     
      -   In Vercel Project Settings, Environment Variables, add ANTHROPIC_API_KEY,
      -   OPENAI_API_KEY (optional), UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN.
     
      -   Vercel's free plan only allows a daily cron, so the real heartbeat is
      -   .github/workflows/run-cycle.yml, a GitHub Actions schedule pinging
      -   /api/cycle every 10 minutes. After deploying, add a repo secret named
      -   DEPLOY_URL set to your deployed Vercel URL (Settings, Secrets and
      -   variables, Actions).
     
      -   ## Honest limitations of this pass
     
      -   No historical price series yet, so the Technical Agent is intentionally
      -   low-confidence. No live news feed, so the News Agent is intentionally
      -   low-confidence too. The event-blackout calendar in lib/config.ts is an
      -   empty placeholder. Position sizing and risk limits in lib/config.ts are
      -   starter numbers, deliberately hard-coded so you can tune them directly.
