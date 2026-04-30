import OpenAI from "openai";

let _client: OpenAI | null = null;

/**
 * OpenAI SDK pointed at OpenRouter (https://openrouter.ai).
 *
 * OpenRouter is a unified gateway that exposes an OpenAI-compatible API for
 * many model providers. Only `apiKey`, `baseURL`, and the optional attribution
 * headers change — streaming, message format, and tool-calling all stay the
 * same as the stock OpenAI SDK.
 *
 * Model names MUST include the provider prefix (e.g. "openai/gpt-4o"). See
 * `src/lib/models.ts`.
 */
export function getOpenAI(): OpenAI {
  if (_client) return _client;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "Missing required environment variable: OPENROUTER_API_KEY. " +
        "Get a key at https://openrouter.ai/keys (format: sk-or-v1-...). " +
        "See .env.example.",
    );
  }
  _client = new OpenAI({
    apiKey: key,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_SITE_URL ?? "https://warp-codx.replit.app",
      "X-Title": "WARP CodX",
    },
  });
  return _client;
}

export const WARP_CMD_SYSTEM_PROMPT = `You are WARP🔹CMD (WARP Commander), the director agent of WalkerMind OS. You receive directives from Mr. Walker and route tasks to WARP•FORGE (build), WARP•SENTINEL (review), and WARP•ECHO (report). Be concise and directive-ready. Always specify which agent should handle a task. Use branch format WARP/{feature-slug}. When you formulate a task ready for dispatch, output it as a clear, structured block.`;
