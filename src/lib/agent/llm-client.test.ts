/**
 * Tests for the agent LLM client: message/tool mapping, response parsing, and
 * the provider failover inherited from the chat layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, resolveProviderChain, markProviderKeyError } = vi.hoisted(
  () => ({
    createMock: vi.fn(),
    resolveProviderChain: vi.fn(),
    markProviderKeyError: vi.fn(async () => {}),
  }),
);

// Share one create() spy across every `new OpenAI(cfg)` instance.
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
    constructor(_cfg: unknown) {}
  },
}));

vi.mock("../provider-chain", () => ({ resolveProviderChain }));
vi.mock("../provider-keys", () => ({ markProviderKeyError }));

import { createAgentLlmClient } from "./llm-client";
import { NO_PROVIDER_MESSAGE } from "../llm";
import { AGENT_TOOLS } from "./tools";
import type { ChatMessage } from "./loop";

function cand(provider: string, keyId: string | null) {
  return {
    source: keyId ? "db" : "env",
    keyId,
    provider,
    baseURL: "http://x",
    apiKey: `k-${provider}`,
    defaultHeaders: {},
  };
}

const resolveModel = () => "test-model";

beforeEach(() => {
  createMock.mockReset();
  resolveProviderChain.mockReset();
  markProviderKeyError.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("createAgentLlmClient", () => {
  it("throws when no provider is configured", async () => {
    resolveProviderChain.mockResolvedValueOnce([]);
    const llm = createAgentLlmClient({ resolveModel });
    await expect(llm([], AGENT_TOOLS)).rejects.toThrow(NO_PROVIDER_MESSAGE);
  });

  it("maps tool calls out of the model reply", async () => {
    resolveProviderChain.mockResolvedValueOnce([cand("openrouter", "key-1")]);
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "reading the file",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "read_file", arguments: '{"path":"a.ts"}' },
              },
            ],
          },
        },
      ],
    });

    const llm = createAgentLlmClient({ resolveModel });
    const turn = await llm([{ role: "user", content: "go" }], AGENT_TOOLS);

    expect(turn.content).toBe("reading the file");
    expect(turn.toolCalls).toEqual([
      { id: "call_1", name: "read_file", arguments: '{"path":"a.ts"}' },
    ]);
    // Tools were forwarded in OpenAI shape.
    const callArg = createMock.mock.calls[0][0];
    expect(callArg.tools).toHaveLength(AGENT_TOOLS.length);
    expect(callArg.tool_choice).toBe("auto");
  });

  it("returns an empty tool list and null content for a bare reply", async () => {
    resolveProviderChain.mockResolvedValueOnce([cand("openai", null)]);
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: null } }] });

    const llm = createAgentLlmClient({ resolveModel });
    const turn = await llm([{ role: "user", content: "hi" }], AGENT_TOOLS);

    expect(turn.content).toBeNull();
    expect(turn.toolCalls).toEqual([]);
  });

  it("serializes assistant tool_calls + tool results back into the request", async () => {
    resolveProviderChain.mockResolvedValueOnce([cand("openrouter", "key-1")]);
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });

    const history: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "task" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", name: "list_dir", arguments: '{"path":"."}' }],
      },
      { role: "tool", tool_call_id: "c1", content: "src\npackage.json" },
    ];

    const llm = createAgentLlmClient({ resolveModel });
    await llm(history, AGENT_TOOLS);

    const sent = createMock.mock.calls[0][0].messages;
    expect(sent[2]).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: { name: "list_dir", arguments: '{"path":"."}' },
        },
      ],
    });
    expect(sent[3]).toMatchObject({ role: "tool", tool_call_id: "c1" });
  });

  it("fails over to the next key on a credit error and records the failure", async () => {
    resolveProviderChain.mockResolvedValueOnce([
      cand("openrouter", "key-1"),
      cand("blackbox", "key-2"),
    ]);
    createMock
      .mockRejectedValueOnce({ status: 402, message: "insufficient credit" })
      .mockResolvedValueOnce({ choices: [{ message: { content: "done" } }] });

    const llm = createAgentLlmClient({ resolveModel });
    const turn = await llm([{ role: "user", content: "go" }], AGENT_TOOLS);

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(turn.content).toBe("done");
    expect(markProviderKeyError).toHaveBeenCalledWith("key-1", expect.any(String));
  });

  it("surfaces a non-credit error without trying the next key", async () => {
    resolveProviderChain.mockResolvedValueOnce([
      cand("openrouter", "key-1"),
      cand("blackbox", "key-2"),
    ]);
    createMock.mockRejectedValueOnce({ status: 400, message: "bad request" });

    const llm = createAgentLlmClient({ resolveModel });
    await expect(llm([], AGENT_TOOLS)).rejects.toMatchObject({ status: 400 });
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
