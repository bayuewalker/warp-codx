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
  isContextLengthError,
  isCreditError,
  isInvalidModelError,
  openChatStreamWithFailover,
  createCompletionWithFailover,
  CONTEXT_TOO_LONG_MESSAGE,
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

describe("isContextLengthError", () => {
  it("is true for OpenAI's context_length_exceeded code", () => {
    expect(
      isContextLengthError({
        status: 400,
        code: "context_length_exceeded",
        message:
          "This model's maximum context length is 128000 tokens. However, your messages resulted in 131015 tokens.",
      }),
    ).toBe(true);
  });
  it("is true for message-only variants (Anthropic / OpenRouter)", () => {
    expect(
      isContextLengthError({
        status: 400,
        message: "prompt is too long: 210011 tokens > 200000 maximum",
      }),
    ).toBe(true);
    expect(
      isContextLengthError({
        error: { message: "This endpoint's maximum context length is 131072 tokens" },
      }),
    ).toBe(true);
  });
  it("is false for quota / billing / invalid-model errors", () => {
    expect(isContextLengthError({ status: 429 })).toBe(false);
    expect(
      isContextLengthError({ error: { message: "You exceeded your quota" } }),
    ).toBe(false);
    expect(
      isContextLengthError({ status: 400, message: "Invalid model name" }),
    ).toBe(false);
  });
  it("keeps context errors OUT of the credit classification", () => {
    // OpenAI's code contains "exceeded", which matched the credit regex
    // and walked the failover chain with a doomed request — regression
    // guard for the carve-out in isCreditError.
    expect(
      isCreditError({
        status: 400,
        code: "context_length_exceeded",
        message: "This model's maximum context length is 128000 tokens.",
      }),
    ).toBe(false);
  });
});

describe("isInvalidModelError", () => {
  it("is true for Blackbox's 400 invalid-model rejection", () => {
    expect(
      isInvalidModelError({
        status: 400,
        error: { message: "Invalid model name passed in model=blackboxai/openai/gpt-4o." },
      }),
    ).toBe(true);
  });
  it("is true for 404 model-not-found variants", () => {
    expect(isInvalidModelError({ status: 404, message: "The model does not exist" })).toBe(true);
    expect(isInvalidModelError({ status: 400, message: "unknown model" })).toBe(true);
  });
  it("is false for credit errors and generic 400s", () => {
    expect(isInvalidModelError({ status: 402, message: "insufficient credit" })).toBe(false);
    expect(isInvalidModelError({ status: 400, message: "missing field content" })).toBe(false);
    expect(isInvalidModelError({ status: 500, message: "invalid model" })).toBe(false);
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

  it("fails over to the next provider on an invalid-model error (no key marked)", async () => {
    resolveProviderChain.mockResolvedValueOnce([
      cand("blackbox", "key-1"),
      cand("openrouter", "key-2"),
    ]);
    const fakeStream = { async *[Symbol.asyncIterator]() {} };
    createMock
      .mockRejectedValueOnce({
        status: 400,
        error: { message: "Invalid model name passed in model=blackboxai/openai/gpt-4o." },
      })
      .mockResolvedValueOnce(fakeStream);

    const res = await openChatStreamWithFailover({ messages: [] });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.provider).toBe("openrouter");
    // A stale slug is not the key's fault — don't record it as a key error.
    expect(markProviderKeyError).not.toHaveBeenCalled();
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

  it("fails fast with an actionable message on a context-length error (no key marked, no next candidate)", async () => {
    resolveProviderChain.mockResolvedValueOnce([
      cand("openrouter", "key-1"),
      cand("blackbox", "key-2"),
    ]);
    createMock.mockRejectedValueOnce({
      status: 400,
      code: "context_length_exceeded",
      message: "This model's maximum context length is 128000 tokens.",
    });

    await expect(openChatStreamWithFailover({ messages: [] })).rejects.toThrow(
      CONTEXT_TOO_LONG_MESSAGE,
    );
    // Every candidate would reject the same oversized prompt — one try only,
    // and the healthy key must NOT be stamped with a bogus last_error.
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(markProviderKeyError).not.toHaveBeenCalled();
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
