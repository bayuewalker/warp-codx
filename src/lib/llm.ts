/**
 * LLM call layer with provider auto-switch.
 *
 * Both helpers walk the provider chain (src/lib/provider-chain.ts) and, when a
 * candidate fails with a credit/quota/auth error, automatically fall through to
 * the next available provider key. A non-credit error (e.g. a bad request) is
 * surfaced immediately rather than masked by a pointless retry.
 */
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { resolveProviderChain, type ProviderCandidate } from "./provider-chain";
import { getModelForProvider, type AgentRole } from "./models";
import { markProviderKeyError } from "./provider-keys";
import type { Provider } from "./provider";

export const NO_PROVIDER_MESSAGE =
  "No LLM provider is configured. An admin needs to add an API key " +
  "(Settings → Admin → Provider keys), or set a provider key in the environment.";

/**
 * True when an error means "this key can't serve the request, try another":
 * out of credit, over quota, rate-limited, or an invalid/expired key.
 */
export function isCreditError(err: unknown): boolean {
  const e = err as { status?: number; code?: string; message?: string; error?: { message?: string } };
  const status = typeof e?.status === "number" ? e.status : undefined;
  if (status === 401 || status === 402 || status === 429) return true;
  const msg = `${e?.message ?? ""} ${e?.error?.message ?? ""} ${e?.code ?? ""}`.toLowerCase();
  return /insufficient|quota|credit|billing|exceeded|payment required|not enough|balance|out of/.test(
    msg,
  );
}

function errMessage(err: unknown): string {
  const e = err as { message?: string; error?: { message?: string } };
  return e?.error?.message ?? e?.message ?? "unknown error";
}

function clientFor(cand: ProviderCandidate): OpenAI {
  return new OpenAI({
    apiKey: cand.apiKey,
    baseURL: cand.baseURL,
    defaultHeaders: cand.defaultHeaders,
  });
}

export type ChatParams = {
  role?: AgentRole;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  maxTokens?: number;
};

export type StreamResult = {
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  provider: Provider;
  model: string;
};

/**
 * Open a streaming chat completion, auto-switching providers on credit errors.
 * Returns the live stream from the first candidate that accepts the request.
 */
export async function openChatStreamWithFailover(
  params: ChatParams,
): Promise<StreamResult> {
  const chain = await resolveProviderChain();
  if (chain.length === 0) throw new Error(NO_PROVIDER_MESSAGE);

  let lastErr: unknown;
  for (const cand of chain) {
    const model = getModelForProvider(cand.provider, params.role ?? "cmd");
    try {
      const stream = await clientFor(cand).chat.completions.create({
        model,
        stream: true,
        temperature: params.temperature ?? 0.6,
        max_tokens: params.maxTokens ?? 8192,
        messages: params.messages,
      });
      return { stream, provider: cand.provider, model };
    } catch (err) {
      lastErr = err;
      if (isCreditError(err)) {
        console.warn(
          `[llm] ${cand.provider} (${cand.source}) failover: ${errMessage(err)}`,
        );
        if (cand.keyId) await markProviderKeyError(cand.keyId, errMessage(err));
        continue; // try the next provider/key
      }
      throw err; // non-credit error — don't mask it
    }
  }
  throw lastErr ?? new Error(NO_PROVIDER_MESSAGE);
}

/**
 * Non-streaming completion with the same failover. Used for best-effort
 * background work (e.g. memory extraction). Returns the assistant text.
 */
export async function createCompletionWithFailover(
  params: ChatParams,
): Promise<{ content: string; provider: Provider; model: string }> {
  const chain = await resolveProviderChain();
  if (chain.length === 0) throw new Error(NO_PROVIDER_MESSAGE);

  let lastErr: unknown;
  for (const cand of chain) {
    const model = getModelForProvider(cand.provider, params.role ?? "echo");
    try {
      const res = await clientFor(cand).chat.completions.create({
        model,
        stream: false,
        temperature: params.temperature ?? 0,
        max_tokens: params.maxTokens ?? 300,
        messages: params.messages,
      });
      return {
        content: res.choices?.[0]?.message?.content ?? "",
        provider: cand.provider,
        model,
      };
    } catch (err) {
      lastErr = err;
      if (isCreditError(err)) {
        if (cand.keyId) await markProviderKeyError(cand.keyId, errMessage(err));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(NO_PROVIDER_MESSAGE);
}
