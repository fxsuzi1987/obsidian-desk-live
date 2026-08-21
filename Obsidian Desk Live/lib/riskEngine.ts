import { RISK_LIMITS, EVENT_BLACKOUTS } from "./config";
import type { JudgeDecision, PaperPortfolio, RiskCheck, RiskDecision } from "./types";

// Deterministic. No LLM call happens in this file — that's the whole point
// of a Risk Engine sitting between "the agents propose" and "anything acts."

function currentlyInBlackout(now: Date): string | null {
  for (const w of EVENT_BLACKOUTS) {
    const start = new Date(w.startUtc).getTime();
    const end = new Date(w.endUtc).getTime();
    const t = now.getTime();
    if (t >= start && t <= end) return w.label;
  }
  return null;
}

export function evaluateRisk(
  decision: JudgeDecision | null,
  portfolio: PaperPortfolio,
  goldPrice: number
): RiskDecision {
  const checks: RiskCheck[] = [];

  if (!decision || decision.call === "NO_TRADE") {
    return {
      outcome: "APPROVED",
      checks: [],
      reason: "No action requested by Judge — nothing for the Risk Engine to check.",
      approvedRiskDollars: 0,
    };
  }

  const blackout = currentlyInBlackout(new Date());
  if (blackout) {
    return {
      outcome: "BLOCKED",
      checks,
      reason: `Blocked: inside event blackout window (${blackout}).`,
      approvedRiskDollars: 0,
    };
  }

  if (portfolio.position) {
    return {
      outcome: "BLOCKED",
      checks,
      reason: "Blocked: a paper position is already open. Close it before opening another.",
      approvedRiskDollars: 0,
    };
  }

  if (decision.entry == null || decision.stop == null) {
    return {
      outcome: "BLOCKED",
      checks,
      reason: "Blocked: Judge did not provide both entry and stop, so risk cannot be sized.",
      approvedRiskDollars: 0,
    };
  }

  const stopDistance = Math.abs(decision.entry - decision.stop);
  if (stopDistance <= 0) {
    return {
      outcome: "BLOCKED",
      checks,
      reason: "Blocked: stop distance is zero or invalid.",
      approvedRiskDollars: 0,
    };
  }

  const proposedRisk = Math.max(0, decision.proposedRiskDollars || 0);

  const perTradeCheck: RiskCheck = {
    name: "Max risk per trade",
    limit: RISK_LIMITS.maxRiskPerTradeDollars,
    current: proposedRisk,
    unit: "$",
    pass: proposedRisk <= RISK_LIMITS.maxRiskPerTradeDollars,
  };
  checks.push(perTradeCheck);

  const equity = portfolio.cash + portfolio.realizedPnl;
  const drawdownPct = portfolio.peakEquity > 0 ? ((portfolio.peakEquity - equity) / portfolio.peakEquity) * 100 : 0;
  const drawdownCheck: RiskCheck = {
    name: "Max drawdown",
    limit: RISK_LIMITS.maxDrawdownPct,
    current: Math.max(0, drawdownPct),
    unit: "%",
    pass: drawdownPct <= RISK_LIMITS.maxDrawdownPct,
  };
  checks.push(drawdownCheck);

  const dailyLossCheck: RiskCheck = {
    name: "Max daily loss",
    limit: RISK_LIMITS.maxDailyLossDollars,
    current: Math.max(0, -portfolio.realizedPnl),
    unit: "$",
    pass: -portfolio.realizedPnl <= RISK_LIMITS.maxDailyLossDollars,
  };
  checks.push(dailyLossCheck);

  const impliedSize = proposedRisk / stopDistance;
  const notionalExposure = impliedSize * goldPrice;
  const exposureCheck: RiskCheck = {
    name: "Max open exposure",
    limit: RISK_LIMITS.maxOpenExposureDollars,
    current: notionalExposure,
    unit: "$",
    pass: notionalExposure <= RISK_LIMITS.maxOpenExposureDollars,
  };
  checks.push(exposureCheck);

  const failed = checks.filter((c) => !c.pass);
  if (failed.length > 0) {
    if (perTradeCheck.pass === false) {
      // Reduce to the max allowed rather than an outright block, mirroring
      // the blueprint's "REDUCED to X" behavior for this specific case.
      const reducedRisk = RISK_LIMITS.maxRiskPerTradeDollars;
      return {
        outcome: "REDUCED",
        checks,
        reason: `Reduced: proposed risk $${proposedRisk.toFixed(0)} exceeded the $${RISK_LIMITS.maxRiskPerTradeDollars} per-trade cap.`,
        approvedRiskDollars: reducedRisk,
      };
    }
    return {
      outcome: "BLOCKED",
      checks,
      reason: `Blocked: ${failed.map((f) => f.name).join(", ")} outside limit.`,
      approvedRiskDollars: 0,
    };
  }

  return {
    outcome: "APPROVED",
    checks,
    reason: "Within all configured limits.",
    approvedRiskDollars: proposedRisk,
  };
}
