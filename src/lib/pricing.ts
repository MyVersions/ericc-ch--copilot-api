// src/lib/pricing.ts
// Prices in USD per million tokens
// Model IDs use dot notation as reported by the Copilot API (e.g. "claude-sonnet-4.6")
export const MODEL_PRICING: Record<
  string,
  { input: number; output: number } | undefined
> = {
  // Claude — current generation
  "claude-opus-4.6": { input: 5.0, output: 25.0 },
  "claude-sonnet-4.6": { input: 3.0, output: 15.0 },
  "claude-haiku-4.5": { input: 1.0, output: 5.0 },
  // Claude — previous generations
  "claude-opus-4.5": { input: 5.0, output: 25.0 },
  "claude-sonnet-4.5": { input: 3.0, output: 15.0 },
  "claude-opus-4.1": { input: 15.0, output: 75.0 },
  "claude-sonnet-4.1": { input: 3.0, output: 15.0 },
  "claude-sonnet-4.0": { input: 3.0, output: 15.0 },
  "claude-opus-4.0": { input: 15.0, output: 75.0 },
  "claude-3.5-sonnet": { input: 3.0, output: 15.0 },
  "claude-3.5-haiku": { input: 1.0, output: 5.0 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  // OpenAI
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  o1: { input: 15.0, output: 60.0 },
  "o1-mini": { input: 1.1, output: 4.4 },
  o3: { input: 10.0, output: 40.0 },
  "o3-mini": { input: 1.1, output: 4.4 },
  o4: { input: 10.0, output: 40.0 },
  "o4-mini": { input: 1.1, output: 4.4 },
}

/**
 * Returns estimated cost in USD, or null if the model has no pricing.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return null
  return (
    (inputTokens / 1_000_000) * pricing.input
    + (outputTokens / 1_000_000) * pricing.output
  )
}
