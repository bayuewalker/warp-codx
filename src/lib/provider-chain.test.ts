/**
 * Tests for the auto-switch chain assembly: DB keys first (by priority), env
 * keys as fallback, dedupe, and the single-key case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listEnabledProviderKeys } = vi.hoisted(() => ({
  listEnabledProviderKeys: vi.fn(),
}));
vi.mock("./provider-keys", () => ({ listEnabledProviderKeys }));

import { resolveProviderChain } from "./provider-chain";

const ENV = [
  "LLM_PROVIDER",
  "OPENROUTER_API_KEY",
  "OPEN_ROUTER_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_API",
  "BLACKBOX_API_KEY",
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  listEnabledProviderKeys.mockReset();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.clearAllMocks();
});

function dbKey(provider: string, api_key: string, priority = 100) {
  return {
    id: `${provider}-${api_key}`,
    provider,
    api_key,
    label: "",
    enabled: true,
    priority,
    last_error: null,
    created_at: "",
    updated_at: "",
  };
}

describe("resolveProviderChain", () => {
  it("returns only the env key when that's all there is", async () => {
    listEnabledProviderKeys.mockResolvedValueOnce([]);
    process.env.BLACKBOX_API_KEY = "env-bb";
    const chain = await resolveProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({
      source: "env",
      provider: "blackbox",
      apiKey: "env-bb",
      keyId: null,
    });
  });

  it("puts DB keys first (priority order) then env fallback", async () => {
    listEnabledProviderKeys.mockResolvedValueOnce([
      dbKey("openai", "db-oai", 10),
      dbKey("blackbox", "db-bb", 5),
    ]);
    process.env.OPENROUTER_API_KEY = "env-or";
    const chain = await resolveProviderChain();
    // listEnabledProviderKeys already returns priority-sorted; chain preserves it.
    expect(chain.map((c) => `${c.source}:${c.provider}`)).toEqual([
      "db:openai",
      "db:blackbox",
      "env:openrouter",
    ]);
  });

  it("dedupes a provider+key present in both DB and env", async () => {
    listEnabledProviderKeys.mockResolvedValueOnce([dbKey("blackbox", "same")]);
    process.env.BLACKBOX_API_KEY = "same";
    const chain = await resolveProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0].source).toBe("db");
  });

  it("leads env entries with the LLM_PROVIDER-selected provider", async () => {
    listEnabledProviderKeys.mockResolvedValueOnce([]);
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENROUTER_API_KEY = "env-or";
    process.env.OPENAI_API_KEY = "env-oai";
    const chain = await resolveProviderChain();
    expect(chain[0].provider).toBe("openai");
  });

  it("falls back to env when the DB lookup throws", async () => {
    listEnabledProviderKeys.mockRejectedValueOnce(new Error("no table"));
    process.env.BLACKBOX_API_KEY = "env-bb";
    const chain = await resolveProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0].apiKey).toBe("env-bb");
  });
});
