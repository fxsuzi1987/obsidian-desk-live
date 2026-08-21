import { extractJSON } from "../lib/llm";

const selfCorrecting = `{"call": "NO_TRADE", "confidence": 0.9, "reasoning": "draft one"}

Wait — I must output only the JSON object. Let me redo cleanly.

{"call": "NO_TRADE", "confidence": 0.9, "reasoning": "Both cases lack evidence.", "evidenceFor": [], "evidenceAgainst": ["a", "b"], "proposedRiskDollars": 0, "entry": null, "stop": null, "target": null, "invalidation": null}`;

const clean = `{"assessment": "Soft USD, mild tailwind.", "confidence": 0.6}`;

const fenced = "```json\n{\"assessment\": \"ok\", \"confidence\": 0.5}\n```";

const nestedBraces = `{"call": "BUY", "confidence": 0.5, "reasoning": "uses {braces} inside a string, and \\"quotes\\" too", "evidenceFor": ["x"], "evidenceAgainst": [], "proposedRiskDollars": 100, "entry": 1, "stop": 2, "target": 3, "invalidation": null}`;

for (const [name, text] of [["self-correcting", selfCorrecting], ["clean", clean], ["fenced", fenced], ["nested-braces-in-string", nestedBraces]] as const) {
    try {
          const parsed = extractJSON<any>(text);
      console.log(`PASS  ${name}:`, JSON.stringify(parsed).slice(0, 100));
    } catch (e) {
          console.log(`FAIL  ${name}:`, e instanceof Error ? e.message : e);
    }
}
