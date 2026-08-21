// One-off manual test: exercises the real agent pipeline against a
// synthetic gold price (since this sandbox can't reach gold-api.com),
// using the real ANTHROPIC_API_KEY env var. Not part of the delivered app.
import { runMacroAgent, runTechnicalAgent, runNewsAgent, runBullAgent, runBearAgent, runSkepticAgent, runJudge } from "../lib/agents";
import { evaluateRisk } from "../lib/riskEngine";

import type { GoldPriceSnapshot, PaperPortfolio } from "../lib/types";

async function main() {
  const gold: GoldPriceSnapshot = { price: 3384.6, currency: "USD", updatedAt: new Date().toISOString(), source: "synthetic-test" };

  console.log("Running research agents...");
  // No historical price feed / news headlines in this synthetic manual test —
  // pass null/[] so the agents take their honest "no data" fallback path,
  // same as a real cycle would when METALPRICE_API_KEY / FINNHUB_API_KEY
  // aren't set or the fetch fails.
  const [macro, technical, news] = await Promise.all([
    runMacroAgent(gold), runTechnicalAgent(gold, null), runNewsAgent(gold, [])]);
  for (const a of [macro, technical, news]) {
    console.log(`\n--- ${a.name} [${a.status}] model=${a.model} conf=${a.confidence} ---`);
    console.log(a.error ? "ERROR: " + a.error : a.output);
  }

  console.log("\nRunning debate agents...");
  const [bull, bear, skeptic] = await Promise.all([
    runBullAgent(gold, macro, technical, news),
    runBearAgent(gold, macro, technical, news),
    runSkepticAgent(gold, macro, technical, news),
  ]);
  for (const a of [bull, bear, skeptic]) {
    console.log(`\n--- ${a.name} [${a.status}] model=${a.model} conf=${a.confidence} ---`);
    console.log(a.error ? "ERROR: " + a.error : a.output);
  }

  console.log("\nRunning judge...");
  const { agent: judgeAgent, decision } = await runJudge(gold, bull, bear, skeptic);
  console.log(`\n--- Judge [${judgeAgent.status}] model=${judgeAgent.model} ---`);
  console.log(judgeAgent.error ? "ERROR: " + judgeAgent.error : JSON.stringify(decision, null, 2));

  const portfolio: PaperPortfolio = { startingEquity: 100000, cash: 100000, realizedPnl: 0, position: null, peakEquity: 100000 };
  const risk = evaluateRisk(decision, portfolio, gold.price);
  console.log("\n--- Risk Engine ---");
  console.log(JSON.stringify(risk, null, 2));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
