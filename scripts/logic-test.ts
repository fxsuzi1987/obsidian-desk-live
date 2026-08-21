import { evaluateRisk } from "../lib/riskEngine";
import { openPaperPosition, monitorPosition, recordBlockedOrRejected } from "../lib/paperExecution";
import type { JudgeDecision, PaperPortfolio } from "../lib/types";

const portfolio: PaperPortfolio = { startingEquity: 100000, cash: 100000, realizedPnl: 0, position: null, peakEquity: 100000 };

const decision1: JudgeDecision = {
    call: "BUY", confidence: 0.7, reasoning: "test",
    evidenceFor: [], evidenceAgainst: [], proposedRiskDollars: 500,
    entry: 3400, stop: 3385, target: 3450, invalidation: "n/a",
};
const risk1 = evaluateRisk(decision1, portfolio, 3400);
console.log("TEST 1 (should APPROVE):", risk1.outcome, risk1.reason);

const { portfolio: p2, journalEntry: j2 } = openPaperPosition(decision1, risk1, portfolio, 3400);
console.log("TEST 1b (position opened):", JSON.stringify(p2.position?.side), "size=", p2.position?.size);

const decision2: JudgeDecision = { ...decision1, proposedRiskDollars: 5000 };
const risk2 = evaluateRisk(decision2, portfolio, 3400);
console.log("TEST 2 (should REDUCE):", risk2.outcome, risk2.approvedRiskDollars);

const risk3 = evaluateRisk(decision1, p2, 3400);
console.log("TEST 3 (should BLOCK, position open):", risk3.outcome, risk3.reason);

const decision4: JudgeDecision = { ...decision1, call: "NO_TRADE" };
const risk4 = evaluateRisk(decision4, portfolio, 3400);
console.log("TEST 4 (NO_TRADE, should APPROVE no-op):", risk4.outcome);

const mon = monitorPosition(p2, 3375);
console.log("TEST 5 (stop hit, should CLOSE):", mon.journalEntry?.status, "pnl=", mon.journalEntry?.pnl.toFixed(2), "newPos=", mon.portfolio.position);

const mon2 = monitorPosition(p2, 3460);
console.log("TEST 6 (target hit, should CLOSE):", mon2.journalEntry?.status, "pnl=", mon2.journalEntry?.pnl.toFixed(2));

const mon3 = monitorPosition(p2, 3410);
console.log("TEST 7 (no hit, should be null):", mon3.journalEntry);

const rec = recordBlockedOrRejected(decision1, risk3);
console.log("TEST 8 (blocked journal entry):", rec?.status, rec?.trace);

const decision9: JudgeDecision = { ...decision1, entry: undefined as any, stop: undefined as any };
const risk9 = evaluateRisk(decision9, portfolio, 3400);
console.log("TEST 9 (missing entry/stop, should BLOCK):", risk9.outcome, risk9.reason);
