import { fetchGoldPrice } from "./marketData";
import { runMacroAgent, runTechnicalAgent, runNewsAgent, runBullAgent, runBearAgent, runSkepticAgent, runJudge } from "./agents";
import { evaluateRisk } from "./riskEngine";
import { openPaperPosition, recordBlockedOrRejected, monitorPosition } from "./paperExecution";
import { loadPortfolio, savePortfolio, saveLatestState, pushJournalEntry, pushLogs, loadJournal, loadLogs } from "./store";
import { hasAnthropicKey } from "./llm";
import type { AgentResult, CycleState, LogEntry } from "./types";

function log(agent: string, level: LogEntry["level"], msg: string): LogEntry {
    return { t: new Date().toISOString(), agent, level, msg };
}

export async function runCycle(): Promise<CycleState> {
    const cycleId = "CYC-" + Date.now().toString(36).toUpperCase();
    const logs: LogEntry[] = [];
    const agents: AgentResult[] = [];

  if (!hasAnthropicKey()) {
        const state: CycleState = {
                cycleId,
                ranAt: new Date().toISOString(),
                gold: null,
                agents: [],
                judge: null,
                risk: null,
                portfolio: await loadPortfolio(),
                journal: await loadJournal(50),
                logs: await loadLogs(50),
                error: "ANTHROPIC_API_KEY is not set — the agent pipeline cannot run yet. Add it in your host's environment variables and re-run.",
        };
        return state;
  }

  // 1. Market data
  let gold;
    try {
          gold = await fetchGoldPrice();
          logs.push(log("Market Data", "INFO", `Gold spot ${gold.price} ${gold.currency} from ${gold.source}.`));
    } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logs.push(log("Market Data", "ERROR", `Gold price fetch failed: ${message}`));
          await pushLogs(logs);
          return {
                  cycleId,
                  ranAt: new Date().toISOString(),
                  gold: null,
                  agents: [],
                  judge: null,
                  risk: null,
                  portfolio: await loadPortfolio(),
                  journal: await loadJournal(50),
                  logs: await loadLogs(50),
                  error: `Could not fetch gold price: ${message}`,
          };
    }
    agents.push({
          id: "market-data",
          name: "Market Data",
          role: "Deterministic feed",
          model: "—",
          status: "RUNNING",
          confidence: null,
          task: "Fetch current XAU/USD spot price.",
          output: `${gold.price} ${gold.currency} as of ${gold.updatedAt} (${gold.source}).`,
          tookMs: 0,
    });

    // 2. Position Monitor runs first against the fresh price, before any new proposal.
  let portfolio = await loadPortfolio();
    const preMonitor = monitorPosition(portfolio, gold.price);
    portfolio = preMonitor.portfolio;
    if (preMonitor.journalEntry) {
          await pushJournalEntry(preMonitor.journalEntry);
          logs.push(log("Position Monitor", "INFO", preMonitor.journalEntry.trace[preMonitor.journalEntry.trace.length - 1]));
    }

  // 3. Research agents, in parallel.
  const [macro, technical, news] = await Promise.all([
        runMacroAgent(gold),
        runTechnicalAgent(gold),
        runNewsAgent(gold),
      ]);
    agents.push(macro, technical, news);
    for (const a of [macro, technical, news]) {
          logs.push(log(a.name, a.status === "ERROR" ? "ERROR" : "INFO", a.error ? a.error : a.output));
    }

  // 4. Debate agents, in parallel — all read the same research notes.
  const [bull, bear, skeptic] = await Promise.all([
        runBullAgent(gold, macro, technical, news),
        runBearAgent(gold, macro, technical, news),
        runSkepticAgent(gold, macro, technical, news),
      ]);
    agents.push(bull, bear, skeptic);
    for (const a of [bull, bear, skeptic]) {
          logs.push(log(a.name, a.status === "ERROR" ? "ERROR" : "INFO", a.error ? a.error : a.output));
    }

  // 5. Judge
  const { agent: judgeAgent, decision: judgeDecision } = await runJudge(gold, bull, bear, skeptic);
    agents.push(judgeAgent);
    logs.push(log("Judge", judgeAgent.status === "ERROR" ? "ERROR" : "INFO", judgeAgent.error ? judgeAgent.error : judgeAgent.output));

  // 6. Risk Engine (deterministic — no LLM call here)
  const risk = evaluateRisk(judgeDecision, portfolio, gold.price);
    agents.push({
          id: "risk-engine",
          name: "Risk Engine",
          role: "Deterministic",
          model: "—",
          status: risk.outcome === "BLOCKED" ? "BLOCKED" : risk.outcome === "REDUCED" ? "REVIEWING" : "APPROVED",
          confidence: null,
          task: "Check the Judge's proposal against hard-coded risk limits.",
          output: risk.reason,
          raw: risk,
          tookMs: 0,
    });
    logs.push(log("Risk Engine", risk.outcome === "BLOCKED" ? "WARN" : "INFO", risk.reason));

  // 7. Paper execution
  let executionOutput = "Idle — no approved order this cycle.";
    let executionStatus: AgentResult["status"] = "WAITING";
    if (judgeDecision && judgeDecision.call !== "NO_TRADE") {
          if (risk.outcome === "APPROVED" || risk.outcome === "REDUCED") {
                  const { portfolio: updated, journalEntry } = openPaperPosition(judgeDecision, risk, portfolio, gold.price);
                  portfolio = updated;
                  await pushJournalEntry(journalEntry);
                  executionOutput = journalEntry.trace[journalEntry.trace.length - 1];
                  executionStatus = "EXECUTING";
                  logs.push(log("Execution", "INFO", executionOutput));
          } else {
                  const journalEntry = recordBlockedOrRejected(judgeDecision, risk);
                  if (journalEntry) await pushJournalEntry(journalEntry);
                  executionOutput = `No order routed — ${risk.reason}`;
                  logs.push(log("Execution", "WARN", executionOutput));
          }
    }
    agents.push({
          id: "execution",
          name: "Execution",
          role: "Deterministic",
          model: "—",
          status: executionStatus,
          confidence: null,
          task: "Route approved paper orders.",
          output: executionOutput,
          tookMs: 0,
    });

  agents.push({
                id: "position-monitor",
        name: "Position Monitor",
        role: "Deterministic",
        model: "—",
        status: portfolio.position ? "RUNNING" : "WAITING",
        confidence: null,
        task: "Track open paper exposure against stop / target.",
        output: portfolio.position
          ? `Open ${portfolio.position.side.toLowerCase()} ${portfolio.position.size.toFixed(3)} oz @ ${portfolio.position.entryPrice.toFixed(2)}, stop ${portfolio.position.stop ?? "—"}, target ${portfolio.position.target ?? "—"}.`
                : "No open position.",
        tookMs: 0,
  });

  portfolio.peakEquity = Math.max(portfolio.peakEquity, portfolio.cash + portfolio.realizedPnl);
    await savePortfolio(portfolio);
    await pushLogs(logs);

  const state: CycleState = {
        cycleId,
        ranAt: new Date().toISOString(),
        gold,
        agents,
        judge: judgeDecision,
        risk,
        portfolio,
        journal: await loadJournal(50),
        logs: await loadLogs(50),
  };
    await saveLatestState(state);
    return state;
}
