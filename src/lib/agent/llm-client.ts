/**
 * Real {@link LlmClient} for the agent loop.
 *
 * `loop.ts` keeps the ReAct cycle pure by taking the model as an injected
 * `LlmClient` function; this module is the production implementation. It wraps
 * the same provider chain the chat layer uses (`provider-chain.ts`), so the
 * agent inherits credit/quota failover across OpenRouter / OpenAI / Blackbox
 * keys for free, and it speaks OpenAI function-calling so {@link AGENT_TOOLS}
 * pass straight through as `tools`.
 *
 * The model slug is chosen per provider by the caller (typically
 * `routeAgentModel` from `model-router.ts`) and passed in as `resolveModel`,
 * keeping difficulty routing out of this transport layer.
 */
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { resolveProviderChain, type ProviderCandidate } from "../provider-chain";
import { markProviderKeyError } from "../provider-keys";
import { isCreditError, NO_PROVIDER_MESSAGE } from "../llm";
import type { Provider } from "../provider";
import type { AssistantTurn, ChatMessage, LlmClient, ToolCall } from "./loop";
import type { ToolDefinition } from "./tools";

export type AgentLlmOptions = {
  /**
   * Resolve the concrete model slug for a given provider. The agent picks the
   * tier (haiku/sonnet/opus) by task difficulty up front and hands a resolver
   * built from `routeAgentModel`; the chain may switch providers mid-run, so
   * the slug is resolved per candidate rather than fixed once.
   */
  resolveModel: (provider: Provider) => string;
  /** Sampling temperature for the coding agent (default: deterministic-ish). */
  temperature?: number;
  /** Per-turn token ceiling for the model's reply (default 4096). */
  maxTokens?: number;
  /** Called with the provider+model that actually served each turn (logging). */
  onCall?: (info: { provider: Provider; model: string }) => void;
};

function clientFor(cand: ProviderCandidate): OpenAI {
  return new OpenAI({
    apiKey: cand.apiKey,
    baseURL: cand.baseURL,
    defaultHeaders: cand.defaultHeaders,
  });
}

function errMessage(err: unknown): string {
  const e = err as { message?: string; error?: { message?: string } };
  return e?.error?.message ?? e?.message ?? "unknown error";
}

/** Map the loop's transport-agnostic messages to OpenAI chat params. */
function toOpenAIMessages(
  messages: ChatMessage[],
): ChatCompletionMessageParam[] {
  return messages.map((m): ChatCompletionMessageParam => {
    switch (m.role) {
      case "system":
        return { role: "system", content: m.content };
      case "user":
        return { role: "user", content: m.content };
      case "tool":
        return {
          role: "tool",
          tool_call_id: m.tool_call_id,
          content: m.content,
        };
      case "assistant":
        return {
          role: "assistant",
          content: m.content,
          ...(m.tool_calls?.length
            ? {
                tool_calls: m.tool_calls.map((tc) => ({
                  id: tc.id,
                  type: "function" as const,
                  function: { name: tc.name, arguments: tc.arguments },
                })),
              }
            : {}),
        };
    }
  });
}

/** OpenAI tool defs are structurally identical to ours; assert the type. */
function toOpenAITools(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools as unknown as ChatCompletionTool[];
}

/** Map the model's reply choice back to the loop's {@link AssistantTurn}. */
function toAssistantTurn(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined,
): AssistantTurn {
  const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
    .filter((tc) => tc.type === "function")
    .map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments ?? "",
    }));
  return { content: message?.content ?? null, toolCalls };
}

/**
 * Build a production {@link LlmClient} bound to the live provider chain. Each
 * call walks the chain, retrying the next key on a credit/quota/auth error and
 * surfacing any other error immediately — the same failover policy as the chat
 * layer. Throws {@link NO_PROVIDER_MESSAGE} when no key is configured.
 */
export function createAgentLlmClient(opts: AgentLlmOptions): LlmClient {
  const temperature = opts.temperature ?? 0.2;
  const maxTokens = opts.maxTokens ?? 4096;

  return async function agentLlm(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): Promise<AssistantTurn> {
    const chain = await resolveProviderChain();
    if (chain.length === 0) throw new Error(NO_PROVIDER_MESSAGE);

    const oaMessages = toOpenAIMessages(messages);
    const oaTools = toOpenAITools(tools);

    let lastErr: unknown;
    for (const cand of chain) {
      const model = opts.resolveModel(cand.provider);
      try {
        const res = await clientFor(cand).chat.completions.create({
          model,
          stream: false,
          temperature,
          max_tokens: maxTokens,
          messages: oaMessages,
          tools: oaTools,
          tool_choice: "auto",
        });
        opts.onCall?.({ provider: cand.provider, model });
        return toAssistantTurn(res.choices?.[0]?.message);
      } catch (err) {
        lastErr = err;
        if (isCreditError(err)) {
          console.warn(
            `[agent-llm] ${cand.provider} (${cand.source}) failover: ${errMessage(err)}`,
          );
          if (cand.keyId) await markProviderKeyError(cand.keyId, errMessage(err));
          continue; // try the next provider/key
        }
        throw err; // non-credit error — don't mask it
      }
    }
    throw lastErr ?? new Error(NO_PROVIDER_MESSAGE);
  };
}
