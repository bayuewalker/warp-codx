import OpenAI from "openai";

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "Missing required environment variable: OPENAI_API_KEY. See .env.example.",
    );
  }
  _client = new OpenAI({ apiKey: key });
  return _client;
}

export const WARP_CMD_SYSTEM_PROMPT = `You are WARP🔹CMD (WARP Commander), the director agent of WalkerMind OS. You receive directives from Mr. Walker and route tasks to WARP•FORGE (build), WARP•SENTINEL (review), and WARP•ECHO (report). Be concise and directive-ready. Always specify which agent should handle a task. Use branch format WARP/{feature-slug}. When you formulate a task ready for dispatch, output it as a clear, structured block.`;
