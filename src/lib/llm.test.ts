/**
 * Tests for the auto-switch LLM layer: credit-error detection and the
 * provider failover behavior (skip a failing key, use the next one).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, resolveProviderChain, markProviderKeyError } = vi.hoisted(
  () => ({
    createMock: vi.fn(),
    resolveProviderChain: vi.fn(),
    markProviderKeyError: vi.fn(async () => {}),
  }),
);

// Mock the OpenAI SDK so every `new OpenAI(cfg)` shares one create() spy.
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
    constructor(_cfg: unknown) {}
  },
}));

vi.mock("./provider-chain", () => ({ resolveProviderChain }));
vi.mock("./provider-keys", () => ({ markProviderKeyError }));

vi.mock("./models", () => ({ getModelForProvider: () => "test-model" }));

import {
  isCreditError,
  openChatStreamWithFailover,
  createCompletionWithFailover,
  NO_PROVIDER_MESSAGE,
} from "./llm";

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

beforeEach(() => {
  createMock.mockReset();
  resolveProviderChain.mockReset();
  markProviderKeyError.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("isCreditError", () => {
  it("is true for 401 / 402 / 429", () => {
    expect(isCreditError({ status: 401 })).toBe(true);
    expect(isCreditError({ status: 402 })).toBe(true);
    expect(isCreditError({ status: 429 })).toBe(true);
  });
  it("is true for quota/credit/billing messages", () => {
    expect(isCreditError({ message: "Insufficient credit" })).toBe(true);
    expect(isCreditError({ error: { message: "You exceeded your quota" } })).toBe(true);
    expect(isCreditError({ message: "billing hard limit reached" })).toBe(true);
  });
  it("is false for unrelated / bad-request errors", () => {
    expect(isCreditError({ status: 400, message: "Invalid model name" })).toBe(false);
    expect(isCreditError({ status: 500 })).toBe(false);
    expect(isCreditError(new Error("boom"))).toBe(false);
  });
});

describe("openChatStreamWithFailover", () => {
  it("throws a clear message when no provider is configured", async () => {
    resolveProviderChain.mockResolvedValueOnce([]);
    await expect(
      openChatStreamWithFailover({ messages: [] }),
    ).rejects.toThrow(NO_PROVIDER_MESSAGE);
  });

  it("switches to the next key on a credit error and records the failure", async () => {
    resolveProviderChain.mockResolvedValueOnce([
      cand("openrouter", "key-1"),
      cand("blackbox", "key-2"),
    ]);
    const fakeStream = { async *[Symbol.asyncIterator]() {} };
    createMock
      .mockRejectedValueOnce({ status: 402, message: "insufficient credit" })
      .mockResolvedValueOnce(fakeStream);

    const res = await openChatStreamWithFailover({ messages: [] });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.provider).toBe("blackbox");
    expect(res.stream).toBe(fakeStream);
    // The exhausted key's error was recorded.
    expect(markProviderKeyError).toHaveBeenCalledWith("key-1", expect.any(String));
  });

  it("surfaces a non-credit error immediately without trying the next key", async () => {
    resolveProviderChain.mockResolvedValueOnce([
      cand("openrouter", "key-1"),
      cand("blackbox", "key-2"),
    ]);
    createMock.mockRejectedValueOnce({ status: 400, message: "bad request" });

    await expect(openChatStreamWithFailover({ messages: [] })).rejects.toMatchObject({
      status: 400,
    });
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

describe("createCompletionWithFailover", () => {
  it("returns content from the first working candidate", async () => {
    resolveProviderChain.mockResolvedValueOnce([cand("blackbox", "key-1")]);
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: "hello" } }],
    });
    const res = await createCompletionWithFailover({ messages: [] });
    expect(res.content).toBe("hello");
    expect(res.provider).toBe("blackbox");
  });
});
