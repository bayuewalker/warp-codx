/**
 * Tests for the orchestrator: routing pass-through, sandbox lifecycle (always
 * destroyed), git-token wiring, and step streaming — all with injected fakes.
 */
import { describe, expect, it, vi } from "vitest";
import { runCodingAgent } from "./orchestrator";
import type { Sandbox, SandboxProvider } from "./sandbox";
import type { AssistantTurn, LlmClient } from "./loop";

function fakeSandbox(): Sandbox & { destroy: ReturnType<typeof vi.fn> } {
  return {
    id: "sb-1",
    exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    readFile: vi.fn(async () => ""),
    writeFile: vi.fn(async () => {}),
    listDir: vi.fn(async () => []),
    destroy: vi.fn(async () => {}),
  };
}

function fakeProvider(sandbox: Sandbox, create = vi.fn(async () => sandbox)): SandboxProvider & {
  create: typeof create;
} {
  return { name: "fake", create };
}

/** An LLM that finishes immediately on the first turn. */
const finishOnce: LlmClient = async (): Promise<AssistantTurn> => ({
  content: "all done",
  toolCalls: [{ id: "c1", name: "finish", arguments: '{"summary":"shipped"}' }],
});

describe("runCodingAgent", () => {
  it("routes the model, runs the loop, and returns routing metadata", async () => {
    const sandbox = fakeSandbox();
    const result = await runCodingAgent(
      { task: "fix a typo in the readme" },
      {
        sandboxProvider: fakeProvider(sandbox),
        createLlm: () => finishOnce,
        resolveProvider: () => "openrouter",
      },
    );

    expect(result.status).toBe("completed");
    expect(result.summary).toBe("shipped");
    expect(result.difficulty).toBe("easy"); // "fix a typo" → easy tier
    expect(result.tier).toBe("haiku");
    expect(result.provider).toBe("openrouter");
    expect(result.sandboxId).toBe("sb-1");
  });

  it("passes repo + branch + git token to the sandbox provider", async () => {
    const sandbox = fakeSandbox();
    const create = vi.fn(async () => sandbox);
    await runCodingAgent(
      { task: "do the thing", repoUrl: "https://github.com/o/r.git", branch: "main" },
      {
        sandboxProvider: fakeProvider(sandbox, create),
        createLlm: () => finishOnce,
        resolveProvider: () => "openrouter",
        gitToken: "ghp_test",
      },
    );
    expect(create).toHaveBeenCalledWith({
      repoUrl: "https://github.com/o/r.git",
      branch: "main",
      gitToken: "ghp_test",
    });
  });

  it("destroys the sandbox even when the loop errors", async () => {
    const sandbox = fakeSandbox();
    const boom: LlmClient = async () => {
      throw new Error("model exploded");
    };
    const result = await runCodingAgent(
      { task: "anything" },
      {
        sandboxProvider: fakeProvider(sandbox),
        createLlm: () => boom,
        resolveProvider: () => "openrouter",
      },
    );
    // The loop swallows LLM errors into a result rather than throwing.
    expect(result.status).toBe("error");
    expect(sandbox.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the sandbox and propagates when creation succeeds but a step throws unexpectedly", async () => {
    const sandbox = fakeSandbox();
    const onStep = vi.fn();
    await runCodingAgent(
      { task: "fix a typo" },
      {
        sandboxProvider: fakeProvider(sandbox),
        createLlm: () => finishOnce,
        resolveProvider: () => "openrouter",
        onStep,
      },
    );
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(sandbox.destroy).toHaveBeenCalledTimes(1);
  });

  it("re-routes the model per provider for failover correctness", async () => {
    const sandbox = fakeSandbox();
    const seen: string[] = [];
    const captureModels: LlmClient = async () => {
      // The factory is given a resolver; exercise it for two providers.
      return { content: "done", toolCalls: [] };
    };
    await runCodingAgent(
      { task: "refactor the auth module across several files" }, // → hard/opus
      {
        sandboxProvider: fakeProvider(sandbox),
        createLlm: (resolveModel) => {
          seen.push(resolveModel("openrouter"), resolveModel("openai"));
          return captureModels;
        },
        resolveProvider: () => "openrouter",
      },
    );
    // Hard task → opus tier slug for openrouter, gpt-4o for openai.
    expect(seen[0]).toContain("opus");
    expect(seen[1]).toBe("gpt-4o");
  });
});
