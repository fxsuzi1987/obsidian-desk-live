import type { JournalEntry, JudgeDecision, PaperPortfolio, RiskDecision } from "./types";

// Simulated fills only. This file never calls a broker or exchange API —
// it just moves numbers around in the paper portfolio object.

function newId(): string {
  return "PT-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function openPaperPosition(
  decision: JudgeDecision,
  risk: RiskDecision,
  portfolio: PaperPortfolio,
  goldPrice: number
): { portfolio: PaperPortfolio; journalEntry: JournalEntry } {
  const entry = decision.entry ?? goldPrice;
  const stop = decision.stop ?? undefined;
  const stopDistance = stop != null ? Math.abs(entry - stop) : null;
  const size = stopDistance && stopDistance > 0 ? risk.approvedRiskDollars / stopDistance : 0;

  const updated: PaperPortfolio = {
    ...portfolio,
    position: {
      side: decision.call === "SELL" ? "SHORT" : "LONG",
      size,
      entryPrice: entry,
      stop: decision.stop ?? undefined,
      target: decision.target ?? undefined,
      openedAt: new Date().toISOString(),
    },
  };

  const journalEntry: JournalEntry = {
    id: newId(),
    t: new Date().toISOString(),
    market: "XAU/USD (paper)",
    side: decision.call === "SELL" ? "SHORT" : "LONG",
    size,
    entry,
    exit: null,
    pnl: 0,
    status: "OPEN",
    trace: [
      `Judge: ${decision.call}, confidence ${(decision.confidence * 100).toFixed(0)}%`,
      `Risk: ${risk.outcome} — ${risk.reason}`,
      `Paper order: opened ${decision.call === "SELL" ? "short" : "long"} ${size.toFixed(3)} oz @ ${entry.toFixed(2)}`,
    ],
  };

  return { portfolio: updated, journalEntry };
}

export function recordBlockedOrRejected(
  decision: JudgeDecision | null,
  risk: RiskDecision
): JournalEntry | null {
  if (!decision || decision.call === "NO_TRADE") return null;
  if (risk.outcome === "APPROVED") return null;
  return {
    id: newId(),
    t: new Date().toISOString(),
    market: "XAU/USD (paper)",
    side: decision.call,
    size: 0,
    entry: null,
    exit: null,
    pnl: 0,
    status: risk.outcome === "BLOCKED" ? "BLOCKED" : "REJECTED",
    trace: [
      `Judge: ${decision.call}, confidence ${(decision.confidence * 100).toFixed(0)}%`,
      `Risk: ${risk.outcome} — ${risk.reason}`,
    ],
  };
}

/** Checks the open paper position against stop/target and closes it if hit. */
export function monitorPosition(
  portfolio: PaperPortfolio,
  goldPrice: number
): { portfolio: PaperPortfolio; journalEntry: JournalEntry | null } {
  const pos = portfolio.position;
  if (!pos) return { portfolio, journalEntry: null };

  let hit: "stop" | "target" | null = null;
  if (pos.side === "LONG") {
    if (pos.stop != null && goldPrice <= pos.stop) hit = "stop";
    else if (pos.target != null && goldPrice >= pos.target) hit = "target";
  } else {
    if (pos.stop != null && goldPrice >= pos.stop) hit = "stop";
    else if (pos.target != null && goldPrice <= pos.target) hit = "target";
  }

  if (!hit) return { portfolio, journalEntry: null };

  const direction = pos.side === "LONG" ? 1 : -1;
  const pnl = (goldPrice - pos.entryPrice) * pos.size * direction;
  const realizedPnl = portfolio.realizedPnl + pnl;
  const equity = portfolio.cash + realizedPnl;

  const updated: PaperPortfolio = {
    ...portfolio,
    realizedPnl,
    position: null,
    peakEquity: Math.max(portfolio.peakEquity, equity),
  };

  const journalEntry: JournalEntry = {
    id: newId(),
    t: new Date().toISOString(),
    market: "XAU/USD (paper)",
    side: pos.side,
    size: pos.size,
    entry: pos.entryPrice,
    exit: goldPrice,
    pnl,
    status: "CLOSED",
    trace: [
      `Position Monitor: ${hit === "stop" ? "stop" : "target"} hit at ${goldPrice.toFixed(2)}`,
      `Closed ${pos.side.toLowerCase()} ${pos.size.toFixed(3)} oz, entry ${pos.entryPrice.toFixed(2)} → exit ${goldPrice.toFixed(2)}`,
      `Realized P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
    ],
  };

  return { portfolio: updated, journalEntry };
}
