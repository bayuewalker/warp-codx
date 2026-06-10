/**
 * Tests for the multi-provider resolution layer. Covers provider selection
 * via LLM_PROVIDER, per-provider key/baseURL resolution, base-URL overrides,
 * OpenRouter attribution headers, and the actionable error paths (unknown
 * provider, missing key).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER,
  getProvider,
  resolveProvider,
  SUPPORTED_PROVIDERS,
} from "./provider";

const ENV_KEYS = [
  "LLM_PROVIDER",
  "OPENROUTER_API_KEY",
  "OPEN_ROUTER_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_API",
  "BLACKBOX_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENAI_BASE_URL",
  "BLACKBOX_BASE_URL",
  "NEXT_PUBLIC_SITE_URL",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getProvider", () => {
  it("defaults to openrouter when LLM_PROVIDER is unset", () => {
    expect(getProvider()).toBe(DEFAULT_PROVIDER);
    expect(DEFAULT_PROVIDER).toBe("openrouter");
  });

  it("is case-insensitive and trims whitespace", () => {
    process.env.LLM_PROVIDER = "  OpenAI ";
    expect(getProvider()).toBe("openai");
  });

  it("accepts every supported provider", () => {
    for (const p of SUPPORTED_PROVIDERS) {
      process.env.LLM_PROVIDER = p;
      expect(getProvider()).toBe(p);
    }
  });

  it("throws on an unknown provider", () => {
    process.env.LLM_PROVIDER = "gemini";
    expect(() => getProvider()).toThrow(/Unknown LLM_PROVIDER/);
  });
});

describe("resolveProvider", () => {
  it("resolves OpenRouter with attribution headers", () => {
    process.env.LLM_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
    const r = resolveProvider();
    expect(r.provider).toBe("openrouter");
    expect(r.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(r.apiKey).toBe("sk-or-test");
    expect(r.defaultHeaders["HTTP-Referer"]).toBe("https://example.test");
    expect(r.defaultHeaders["X-Title"]).toBe("WARP CodX");
  });

  it("accepts the OPEN_ROUTER_API_KEY alias for OpenRouter", () => {
    process.env.LLM_PROVIDER = "openrouter";
    process.env.OPEN_ROUTER_API_KEY = "sk-or-alias";
    const r = resolveProvider();
    expect(r.apiKey).toBe("sk-or-alias");
  });

  it("accepts the OPENAI_API alias for OpenAI", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API = "sk-oai-alias";
    const r = resolveProvider();
    expect(r.apiKey).toBe("sk-oai-alias");
  });

  it("resolves OpenAI with no attribution headers", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-openai-test";
    const r = resolveProvider();
    expect(r.provider).toBe("openai");
    expect(r.baseURL).toBe("https://api.openai.com/v1");
    expect(r.apiKey).toBe("sk-openai-test");
    expect(r.defaultHeaders).toEqual({});
  });

  it("resolves Blackbox to its OpenAI-compatible host", () => {
    process.env.LLM_PROVIDER = "blackbox";
    process.env.BLACKBOX_API_KEY = "bb-test";
    const r = resolveProvider();
    expect(r.provider).toBe("blackbox");
    expect(r.baseURL).toBe("https://api.blackbox.ai");
    expect(r.apiKey).toBe("bb-test");
  });

  it("honors a per-provider base-URL override", () => {
    process.env.LLM_PROVIDER = "blackbox";
    process.env.BLACKBOX_API_KEY = "bb-test";
    process.env.BLACKBOX_BASE_URL = "https://enterprise.blackbox.ai";
    expect(resolveProvider().baseURL).toBe("https://enterprise.blackbox.ai");
  });

  it("throws a clear error naming the missing key env", () => {
    process.env.LLM_PROVIDER = "openai";
    expect(() => resolveProvider()).toThrow(/OPENAI_API_KEY/);
  });
});
