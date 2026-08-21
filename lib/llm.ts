import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
    if (!process.env.ANTHROPIC_API_KEY) {
          throw new Error("ANTHROPIC_API_KEY is not set");
    }
    if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return anthropic;
}

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
    if (!process.env.OPENAI_API_KEY) {
          throw new Error("OPENAI_API_KEY is not set");
    }
    if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai;
}

export function hasAnthropicKey(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
}
export function hasOpenAIKey(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
}

/** Calls Claude and returns raw text output. Throws on API error. */
export async function callClaude(model: string, system: string, user: string): Promise<string> {
    const client = getAnthropic();
    const msg = await client.messages.create({
          model,
          max_tokens: 700,
          system,
          messages: [{ role: "user", content: user }],
    });
    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("Claude response contained no text block");
    return block.text;
}

/** Calls OpenAI and returns raw text output. Throws on API error. */
export async function callOpenAI(model: string, system: string, user: string): Promise<string> {
    const client = getOpenAI();
    const resp = await client.chat.completions.create({
          model,
          max_tokens: 700,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
                ],
    });
    const text = resp.choices[0]?.message?.content;
    if (!text) throw new Error("OpenAI response contained no content");
    return text;
}

/**
 * Runs a prompt against whichever provider `preferredModel` implies,
 * falling back to Claude if that provider's key is missing (so the whole
 * cycle degrades gracefully instead of failing outright when only one key
 * is configured).
 */
export async function callModel(
    preferredModel: string,
    system: string,
    user: string
  ): Promise<{ text: string; modelUsed: string }> {
    const isOpenAIModel = preferredModel.startsWith("gpt-");
    if (isOpenAIModel && hasOpenAIKey()) {
          return { text: await callOpenAI(preferredModel, system, user), modelUsed: preferredModel };
    }
    if (isOpenAIModel && !hasOpenAIKey()) {
          // Fall back to Claude so a missing OpenAI key doesn't stall the whole desk.
      const fallback = "claude-sonnet-5";
          return { text: await callClaude(fallback, system, user), modelUsed: `${fallback} (fallback, no OPENAI_API_KEY)` };
    }
    return { text: await callClaude(preferredModel, system, user), modelUsed: preferredModel };
}

/**
 * Finds every balanced top-level {...} substring in text (by brace depth,
 * ignoring braces inside strings), in the order they appear.
 */
function findBalancedJSONObjects(text: string): string[] {
    const results: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (inString) {
                  if (escaped) escaped = false;
                  else if (ch === "\\") escaped = true;
                  else if (ch === '"') inString = false;
                  continue;
          }
          if (ch === '"') {
                  inString = true;
                  continue;
          }
          if (ch === "{") {
                  if (depth === 0) start = i;
                  depth++;
          } else if (ch === "}") {
                  depth--;
                  if (depth === 0 && start !== -1) {
                            results.push(text.slice(start, i + 1));
                            start = -1;
                  } else if (depth < 0) {
                            depth = 0; // stray closing brace outside any object — ignore
                  }
          }
    }
    return results;
}

/**
 * Extracts a JSON object from a model's text output. Models occasionally
 * second-guess themselves mid-response (emit a draft, say "wait, let me
 * redo that", then emit a corrected object) — naive first-{-to-last-}
 * slicing would swallow both objects and the prose between them into one
 * unparseable blob. Instead this finds every balanced {...} substring and
 * tries them from LAST to FIRST, since a self-correction pattern puts the
 * intended answer last, returning the first one that actually parses.
 */
export function extractJSON<T = unknown>(text: string): T {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : text;
    const objects = findBalancedJSONObjects(candidate);
    for (let i = objects.length - 1; i >= 0; i--) {
          try {
                  return JSON.parse(objects[i]) as T;
          } catch {
                  continue;
          }
    }
    throw new Error("No parseable JSON object found in model output: " + text.slice(0, 300));
}
