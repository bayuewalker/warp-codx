/**
 * Tests for the coding-agent difficulty router. Covers the classifier's
 * ordering (hard > easy > medium), the short/long word gates, env overrides,
 * and per-provider resolution including the OpenAI (no-Claude) fallbacks.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyTaskDifficulty,
  resolveAgentModel,
  routeAgentModel,
} from "./model-router";

const ENV_KEYS = ["AGENT_MODEL_HAIKU", "AGENT_MODEL_SONNET", "AGENT_MODEL_OPUS"];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("classifyTaskDifficulty", () => {
  it("flags structural work as hard", () => {
    expect(classifyTaskDifficulty("Refactor the auth module")).toBe("hard");
    expect(classifyTaskDifficulty("migrate the database to Postgres")).toBe(
      "hard",
    );
    expect(
      classifyTaskDifficulty("optimize the render performance of the list"),
    ).toBe("hard");
  });

  it("flags very long briefs as hard regardless of verbs", () => {
    const longEasyLooking =
      "fix typo " + Array.from({ length: 65 }, (_, i) => `word${i}`).join(" ");
    expect(classifyTaskDifficulty(longEasyLooking)).toBe("hard");
  });

  it("flags short localized edits as easy", () => {
    expect(classifyTaskDifficulty("fix a typo in the README")).toBe("easy");
    expect(classifyTaskDifficulty("rename getUser to fetchUser")).toBe("easy");
    expect(classifyTaskDifficulty("bump the version to 1.2.0")).toBe("easy");
  });

  it("does not call a long easy-verb task easy", () => {
    const longish =
      "rename the function and also update every call site across the helpers and the tests and the docs and the examples folder too please";
    expect(classifyTaskDifficulty(longish)).not.toBe("easy");
  });

  it("lets hard beat easy when both signals are present", () => {
    expect(classifyTaskDifficulty("refactor and fix a typo")).toBe("hard");
  });

  it("defaults to medium for everything else", () => {
    expect(classifyTaskDifficulty("add a logout button to the navbar")).toBe(
      "medium",
    );
    expect(classifyTaskDifficulty("")).toBe("medium");
  });
});

describe("resolveAgentModel", () => {
  it("uses the per-provider matrix by default", () => {
    expect(resolveAgentModel("haiku", "openrouter")).toBe(
      "anthropic/claude-haiku-4.5",
    );
    expect(resolveAgentModel("sonnet", "blackbox")).toBe(
      "blackboxai/anthropic/claude-sonnet-4.6",
    );
  });

  it("falls back to gpt models on OpenAI (no Claude)", () => {
    expect(resolveAgentModel("haiku", "openai")).toBe("gpt-4o-mini");
    expect(resolveAgentModel("opus", "openai")).toBe("gpt-4o");
  });

  it("honors the AGENT_MODEL_* env override for the matching tier", () => {
    process.env.AGENT_MODEL_HAIKU = "custom/haiku-slug";
    expect(resolveAgentModel("haiku", "openrouter")).toBe("custom/haiku-slug");
    // other tiers untouched
    expect(resolveAgentModel("sonnet", "openrouter")).toBe(
      "anthropic/claude-sonnet-4-6",
    );
  });
});

describe("routeAgentModel", () => {
  it("returns difficulty, tier, and resolved slug together", () => {
    expect(routeAgentModel("fix a typo in the README", "openrouter")).toEqual({
      difficulty: "easy",
      tier: "haiku",
      model: "anthropic/claude-haiku-4.5",
    });
    expect(routeAgentModel("refactor the auth module", "blackbox")).toEqual({
      difficulty: "hard",
      tier: "opus",
      model: "blackboxai/anthropic/claude-opus-4.6",
    });
  });
});
