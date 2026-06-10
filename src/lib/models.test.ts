/**
 * Tests for provider-aware model resolution: per-provider defaults, the
 * LLM_MODEL override, and the display formatter.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatModelSlug, getModel, MODELS } from "./models";

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
    expect(getModel("cmd")).toBe("blackboxai/anthropic/claude-sonnet-4");
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

describe("formatModelSlug", () => {
  it("strips provider prefix and the claude- tag", () => {
    expect(formatModelSlug("anthropic/claude-sonnet-4-6")).toBe("sonnet-4-6");
    expect(formatModelSlug("blackboxai/anthropic/claude-sonnet-4")).toBe(
      "sonnet-4",
    );
    expect(formatModelSlug("gpt-4o")).toBe("gpt-4o");
  });
});
