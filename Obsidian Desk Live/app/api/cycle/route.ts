import { NextResponse } from "next/server";
import { runCycle } from "@/lib/cycle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron sends GET. A manual "Run cycle now" button in the UI sends POST.
// Both do the same thing — one full agent cycle, paper trading only.
export async function GET() {
  const state = await runCycle();
  return NextResponse.json(state);
}

export async function POST() {
  const state = await runCycle();
  return NextResponse.json(state);
}
