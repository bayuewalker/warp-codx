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
  isCodingMessage,
  isSelectableModelId,
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
  });

  it("validates selectable ids", () => {
    expect(isSelectableModelId("auto")).toBe(true);
    expect(isSelectableModelId("sonnet")).toBe(true);
    expect(isSelectableModelId("nope")).toBe(false);
    expect(isSelectableModelId(null)).toBe(false);
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
