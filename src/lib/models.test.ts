/**
 * Tests for provider-aware model resolution: per-provider defaults, the
 * LLM_MODEL override, and the display formatter.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatModelSlug,
  getModel,
  MODELS,
  autoPickModelId,
  availableSelectableModels,
  isCodingMessage,
  isModelAvailable,
  isSelectableModelId,
  providersForModel,
  resolveSelectedModel,
} from "./models";

const ENV_KEYS = ["LLM_PROVIDER", "LLM_MODEL"];
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

describe("getModel", () => {
  it("defaults to the OpenRouter cmd model when nothing is set", () => {
    expect(getModel("cmd")).toBe("anthropic/claude-sonnet-4-6");
    // Default role is "cmd".
    expect(getModel()).toBe("anthropic/claude-sonnet-4-6");
  });

  it("resolves per-provider defaults for each role", () => {
    process.env.LLM_PROVIDER = "openai";
    expect(getModel("cmd")).toBe("gpt-4o");
    expect(getModel("echo")).toBe("gpt-4o-mini");

    process.env.LLM_PROVIDER = "blackbox";
    expect(getModel("cmd")).toBe("blackboxai/anthropic/claude-sonnet-4.6");
  });

  it("LLM_MODEL overrides every provider/role", () => {
    process.env.LLM_PROVIDER = "blackbox";
    process.env.LLM_MODEL = "blackboxai/openai/gpt-4o";
    expect(getModel("cmd")).toBe("blackboxai/openai/gpt-4o");
    expect(getModel("echo")).toBe("blackboxai/openai/gpt-4o");
  });

  it("MODELS stays backward-compatible with the OpenRouter map", () => {
    expect(MODELS.cmd).toBe("anthropic/claude-sonnet-4-6");
  });
});

describe("model selection (picker + auto)", () => {
  it("classifies coding vs chat messages", () => {
    expect(isCodingMessage("fix this bug in my function")).toBe(true);
    expect(isCodingMessage("write a python script")).toBe(true);
    expect(isCodingMessage("```\nconst x = 1\n```")).toBe(true);
    expect(isCodingMessage("how are you today?")).toBe(false);
    expect(isCodingMessage("what's a good recipe for soup")).toBe(false);
  });

  it("auto routes coding → sonnet and chat → gpt-4o", () => {
    expect(autoPickModelId("refactor this component")).toBe("sonnet");
    expect(autoPickModelId("tell me a joke")).toBe("gpt-4o");
  });

  it("resolves a selected model to the right per-provider slug", () => {
    expect(resolveSelectedModel("sonnet", "openrouter")).toBe(
      "anthropic/claude-sonnet-4-6",
    );
    expect(resolveSelectedModel("sonnet", "blackbox")).toBe(
      "blackboxai/anthropic/claude-sonnet-4.6",
    );
    expect(resolveSelectedModel("gpt-4o", "openai")).toBe("gpt-4o");
  });

  it("falls back to the provider cmd default for an unmapped model", () => {
    // Sonnet has no native OpenAI slug → falls back to the OpenAI cmd default.
    expect(resolveSelectedModel("sonnet", "openai")).toBe("gpt-4o");
    // Opus has no OpenAI slug either → same graceful fallback.
    expect(resolveSelectedModel("opus", "openai")).toBe("gpt-4o");
  });

  it("resolves the newly added opus + gpt-5 models", () => {
    expect(resolveSelectedModel("opus", "openrouter")).toBe(
      "anthropic/claude-opus-4-6",
    );
    expect(resolveSelectedModel("opus", "blackbox")).toBe(
      "blackboxai/anthropic/claude-opus-4.6",
    );
    expect(resolveSelectedModel("gpt-5", "openai")).toBe("gpt-5");
    expect(resolveSelectedModel("gpt-5", "blackbox")).toBe(
      "blackboxai/openai/gpt-5.5",
    );
  });

  it("validates selectable ids", () => {
    expect(isSelectableModelId("auto")).toBe(true);
    expect(isSelectableModelId("sonnet")).toBe(true);
    expect(isSelectableModelId("opus")).toBe(true);
    expect(isSelectableModelId("gpt-5")).toBe(true);
    expect(isSelectableModelId("nope")).toBe(false);
    expect(isSelectableModelId(null)).toBe(false);
  });
});

describe("availability (composer picker)", () => {
  it("providersForModel lists mapped providers; null for auto", () => {
    expect(providersForModel("auto")).toBeNull();
    expect(providersForModel("opus")).toEqual(["openrouter", "blackbox"]);
    // Sonnet maps all three (OpenAI via the gpt-4o fallback slug).
    expect(providersForModel("sonnet")).toEqual(["openrouter", "blackbox", "openai"]);
  });

  it("isModelAvailable needs an active provider that maps the model", () => {
    expect(isModelAvailable("auto", [])).toBe(false); // nothing active
    expect(isModelAvailable("auto", ["blackbox"])).toBe(true); // any active works
    expect(isModelAvailable("opus", ["openai"])).toBe(false); // OpenAI lacks opus
    expect(isModelAvailable("opus", ["openrouter"])).toBe(true);
    expect(isModelAvailable("gpt-5", ["blackbox"])).toBe(true);
  });

  it("availableSelectableModels filters to what an active provider can serve", () => {
    // Only OpenAI active → auto + GPT models (opus drops; sonnet stays via fallback).
    const ids = availableSelectableModels(["openai"]).map((m) => m.id);
    expect(ids).toContain("auto");
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("sonnet");
    expect(ids).not.toContain("opus");

    // No active provider → empty (picker shows the "no provider" state).
    expect(availableSelectableModels([])).toEqual([]);
  });
});

describe("formatModelSlug", () => {
  it("strips provider prefix and the claude- tag", () => {
    expect(formatModelSlug("anthropic/claude-sonnet-4-6")).toBe("sonnet-4-6");
    expect(formatModelSlug("blackboxai/anthropic/claude-sonnet-4.6")).toBe(
      "sonnet-4.6",
    );
    expect(formatModelSlug("gpt-4o")).toBe("gpt-4o");
  });
});
