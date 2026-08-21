// Shared types for the live Gold Desk pipeline.
// Everything here describes PAPER trading only — nothing in this codebase
// is wired to a real broker or exchange account.

export type AgentStatus =
  | "WAITING"
  | "RUNNING"
  | "REQUESTING_DATA"
  | "REVIEWING"
  | "APPROVED"
  | "REJECTED"
  | "BLOCKED"
  | "EXECUTING"
  | "ERROR";

export interface AgentResult {
  id: string;
  name: string;
  role: string;
  model: string;
  status: AgentStatus;
  confidence: number | null;
  task: string;
  output: string;
  raw?: unknown;
  error?: string;
  tookMs: number;
}

export interface GoldPriceSnapshot {
  price: number;
  currency: string;
  updatedAt: string;
  source: string;
}

export interface JudgeDecision {
  call: "BUY" | "SELL" | "NO_TRADE";
  confidence: number;
  reasoning: string;
  evidenceFor: string[];
  evidenceAgainst: string[];
  proposedRiskDollars: number;
  entry?: number;
  stop?: number;
  target?: number;
  invalidation?: string;
}

export interface RiskCheck {
  name: string;
  limit: number;
  current: number;
  unit: "$" | "%" | "x";
  pass: boolean;
}

export interface RiskDecision {
  outcome: "APPROVED" | "BLOCKED" | "REDUCED";
  checks: RiskCheck[];
  reason: string;
  approvedRiskDollars: number;
}

export interface PaperPosition {
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  stop?: number;
  target?: number;
  openedAt: string;
}

export interface PaperPortfolio {
  startingEquity: number;
  cash: number;
  realizedPnl: number;
  position: PaperPosition | null;
  peakEquity: number;
}

export interface JournalEntry {
  id: string;
  t: string;
  market: string;
  side: string;
  size: number;
  entry: number | null;
  exit: number | null;
  pnl: number;
  status: "OPEN" | "CLOSED" | "REJECTED" | "BLOCKED";
  trace: string[];
}

export interface LogEntry {
  t: string;
  agent: string;
  level: "INFO" | "WARN" | "ERROR";
  msg: string;
}

export interface CycleState {
  cycleId: string;
  ranAt: string;
  gold: GoldPriceSnapshot | null;
  agents: AgentResult[];
  judge: JudgeDecision | null;
  risk: RiskDecision | null;
  portfolio: PaperPortfolio;
  journal: JournalEntry[];
  logs: LogEntry[];
  error?: string;
}
