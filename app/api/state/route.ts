import { NextResponse } from "next/server";
import { loadLatestState, loadPortfolio, loadJournal, loadLogs } from "@/lib/store";
import { hasAnthropicKey, hasOpenAIKey } from "@/lib/llm";
import { hasMetalPriceKey, hasFinnhubKey } from "@/lib/marketData";
import { usingPersistentStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const [state, portfolio, journal, logs, persistent] = await Promise.all([
    loadLatestState(),
    loadPortfolio(),
    loadJournal(50),
    loadLogs(50),
    usingPersistentStore(),
  ]);
  return NextResponse.json({
    state,
    portfolio,
    journal,
    logs,
    env: {
      hasAnthropicKey: hasAnthropicKey(),
      hasOpenAIKey: hasOpenAIKey(),
      hasMetalPriceKey: hasMetalPriceKey(),
      hasFinnhubKey: hasFinnhubKey(),
      persistentStore: persistent,
    },
  });
}
