import { callModel, extractJSON } from "./llm";
import { MODELS } from "./config";
import type { AgentResult, GoldPriceSnapshot, JudgeDecision } from "./types";

const JSON_INSTRUCTION =
  'Respond with ONLY a single JSON object and nothing else: no prose before or after, no markdown ' +
  'fences, no drafting out loud, no "let me redo that" — think it through silently and output the ' +
  'final object once. Every string field must be one or two sentences at most.';

async function runResearchAgent(params: {
  id: string;
  name: string;
  role: string;
  model: string;
  task: string;
  system: string;
  userPrompt: string;
}): Promise<AgentResult> {
  const start = Date.now();
  try {
    const { text, modelUsed } = await callModel(params.model, params.system, params.userPrompt);
    const parsed = extractJSON<{ assessment: string; confidence: number }>(text);
    return {
      id: params.id,
      name: params.name,
      role: params.role,
      model: modelUsed,
      status: "RUNNING",
      confidence: clamp01(parsed.confidence),
      task: params.task,
      output: parsed.assessment,
      raw: parsed,
      tookMs: Date.now() - start,
    };
  } catch (err) {
    return {
      id: params.id,
      name: params.name,
      role: params.role,
      model: params.model,
      status: "ERROR",
      confidence: null,
      task: params.task,
      output: "Agent call failed — see error.",
      error: err instanceof Error ? err.message : String(err),
      tookMs: Date.now() - start,
    };
  }
}

function clamp01(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

export async function runMacroAgent(gold: GoldPriceSnapshot): Promise<AgentResult> {
  return runResearchAgent({
    id: "macro",
    name: "Macro Agent",
    role: "Research",
    model: MODELS.macro,
    task: "Assess USD strength, real yields, and Fed policy expectations relative to gold flow.",
    system:
      "You are a macro research analyst for a systematic gold desk. Reason about USD strength, " +
      "real/nominal yields, and Fed policy expectations, and how they likely affect XAU/USD flows " +
      "right now. You do not have live news access — reason from general macro logic and flag that " +
      "explicitly rather than inventing specific data points you cannot verify. " +
      JSON_INSTRUCTION +
      ' Schema: {"assessment": string, "confidence": number between 0 and 1}.',
    userPrompt: `Current gold spot price: ${gold.price} ${gold.currency} (source: ${gold.source}, as of ${gold.updatedAt}). Give your macro assessment for gold right now.`,
  });
}

export async function runTechnicalAgent(gold: GoldPriceSnapshot): Promise<AgentResult> {
  return runResearchAgent({
    id: "technical",
    name: "Technical Agent",
    role: "Research",
    model: MODELS.technical,
    task: "Score structure, momentum, and volatility regime from the current price alone.",
    system:
      "You are a technical analyst for a systematic gold desk. You are given only the current spot " +
      "price, with no historical series or chart. Be explicit that without historical bars you cannot " +
      "assess structure, momentum, or support/resistance with real confidence — score confidence low " +
      "(0.2-0.4) accordingly rather than fabricating trend claims. " +
      JSON_INSTRUCTION +
      ' Schema: {"assessment": string, "confidence": number between 0 and 1}.',
    userPrompt: `Current gold spot price: ${gold.price} ${gold.currency} as of ${gold.updatedAt}. No historical price series is available yet in this build. Give your honest technical read given that limitation.`,
  });
}

export async function runNewsAgent(gold: GoldPriceSnapshot): Promise<AgentResult> {
  return runResearchAgent({
    id: "news",
    name: "News Agent",
    role: "Research",
    model: MODELS.news,
    task: "Scan for event risk near the current time (no live news feed connected yet).",
    system:
      "You are a news/event-risk analyst for a systematic gold desk. This deployment does not yet have " +
      "a live news feed wired in. Say so plainly, note what kinds of events would matter (CPI, FOMC, " +
      "payrolls, geopolitical shocks) and set confidence low (around 0.2) since you have no real " +
      "current information. Do not invent specific headlines or events. " +
      JSON_INSTRUCTION +
      ' Schema: {"assessment": string, "confidence": number between 0 and 1}.',
    userPrompt: `Current gold spot price: ${gold.price} ${gold.currency} as of ${gold.updatedAt}. Give your event-risk assessment given no live news feed is connected.`,
  });
}

async function runDebateAgent(params: {
  id: string;
  name: string;
  model: string;
  task: string;
  stance: string;
  gold: GoldPriceSnapshot;
  macro: AgentResult;
  technical: AgentResult;
  news: AgentResult;
}): Promise<AgentResult> {
  const context = `Macro Agent: ${params.macro.output} (confidence ${params.macro.confidence})
Technical Agent: ${params.technical.output} (confidence ${params.technical.confidence})
News Agent: ${params.news.output} (confidence ${params.news.confidence})`;
  return runResearchAgent({
    id: params.id,
    name: params.name,
    role: "Debate",
    model: params.model,
    task: params.task,
    system:
      `You are the ${params.stance} in a structured debate about whether to open a new gold (XAU/USD) ` +
      "position right now, on a research/paper-trading desk. Use the three research notes you're given. " +
      "Be honest about weak evidence rather than overstating conviction. " +
      JSON_INSTRUCTION +
      ' Schema: {"assessment": string, "confidence": number between 0 and 1}.',
    userPrompt: `Gold spot: ${params.gold.price} ${params.gold.currency}.\n\nResearch notes:\n${context}\n\nGive your case.`,
  });
}

export async function runBullAgent(gold: GoldPriceSnapshot, macro: AgentResult, technical: AgentResult, news: AgentResult) {
  return runDebateAgent({
    id: "bull",
    name: "Bull Agent",
    model: MODELS.bull,
    task: "Build the strongest honest case for long gold exposure.",
    stance: "bull case advocate — argue for opening or holding long exposure",
    gold,
    macro,
    technical,
    news,
  });
}

export async function runBearAgent(gold: GoldPriceSnapshot, macro: AgentResult, technical: AgentResult, news: AgentResult) {
  return runDebateAgent({
    id: "bear",
    name: "Bear Agent",
    model: MODELS.bear,
    task: "Build the strongest honest case against opening new exposure.",
    stance: "bear case advocate — argue against opening new long exposure right now",
    gold,
    macro,
    technical,
    news,
  });
}

export async function runSkepticAgent(gold: GoldPriceSnapshot, macro: AgentResult, technical: AgentResult, news: AgentResult) {
  return runDebateAgent({
    id: "skeptic",
    name: "Skeptic Agent",
    model: MODELS.skeptic,
    task: "Stress-test both the bull and bear cases for overconfidence.",
    stance: "skeptic — you have not seen the bull/bear cases yet, so instead critique the quality of the underlying research notes themselves",
    gold,
    macro,
    technical,
    news,
  });
}

export async function runJudge(
  gold: GoldPriceSnapshot,
  bull: AgentResult,
  bear: AgentResult,
  skeptic: AgentResult
): Promise<{ agent: AgentResult; decision: JudgeDecision | null }> {
  const start = Date.now();
  const context = `Bull case: ${bull.output} (confidence ${bull.confidence})
Bear case: ${bear.output} (confidence ${bear.confidence})
Skeptic notes: ${skeptic.output} (confidence ${skeptic.confidence})`;
  try {
    const { text, modelUsed } = await callModel(
      MODELS.judge,
      "You are the Judge on a systematic gold (XAU/USD) research desk. This is PAPER TRADING ONLY — " +
        "no real money is ever at stake, so you should still be conservative and honest, but you are not " +
        "risking real capital. Weigh the bull case, bear case, and skeptic notes into one decision. Given " +
        "that this build has no historical price data and no live news feed yet, you should default to " +
        "NO_TRADE unless the case for action is unusually strong, and say so. " +
        JSON_INSTRUCTION +
        ' Schema: {"call": "BUY" | "SELL" | "NO_TRADE", "confidence": number 0-1, "reasoning": string, ' +
        '"evidenceFor": string[] (max 3, short), "evidenceAgainst": string[] (max 3, short), ' +
        '"proposedRiskDollars": number (0 if NO_TRADE), "entry": number | null, "stop": number | null, ' +
        '"target": number | null, "invalidation": string | null}.',
      `Gold spot: ${gold.price} ${gold.currency}.\n\n${context}\n\nMake the call.`
    );
    const decision = extractJSON<JudgeDecision>(text);
    return {
      agent: {
        id: "judge",
        name: "Judge",
        role: "Arbitration",
        model: modelUsed,
        status: decision.call === "NO_TRADE" ? "REJECTED" : "APPROVED",
        confidence: clamp01(decision.confidence),
        task: "Weigh bull/bear/skeptic into one decision.",
        output: decision.reasoning,
        raw: decision,
        tookMs: Date.now() - start,
      },
      decision,
    };
  } catch (err) {
    return {
      agent: {
        id: "judge",
        name: "Judge",
        role: "Arbitration",
        model: MODELS.judge,
        status: "ERROR",
        confidence: null,
        task: "Weigh bull/bear/skeptic into one decision.",
        output: "Judge call failed — see error.",
        error: err instanceof Error ? err.message : String(err),
        tookMs: Date.now() - start,
      },
      decision: null,
    };
  }
}
