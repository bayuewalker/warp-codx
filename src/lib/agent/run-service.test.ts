/**
 * Tests for the run service: validation, the concurrency limit, up-front
 * routing stamp, and terminal persistence of a detached run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createAgentRun, listAgentRuns, updateAgentRun, runCodingAgent } =
  vi.hoisted(() => ({
    createAgentRun: vi.fn(),
    listAgentRuns: vi.fn(),
    updateAgentRun: vi.fn(async () => {}),
    runCodingAgent: vi.fn(),
  }));

vi.mock("./agent-runs", () => ({ createAgentRun, listAgentRuns, updateAgentRun }));
vi.mock("./orchestrator", () => ({ runCodingAgent }));

import { startAgentRun, MAX_CONCURRENT_RUNS } from "./run-service";

const deps = { resolveProvider: () => "openrouter" as const };

beforeEach(() => {
  createAgentRun.mockReset();
  listAgentRuns.mockReset().mockResolvedValue([]);
  updateAgentRun.mockClear();
  runCodingAgent.mockReset();
});
afterEach(() => vi.clearAllMocks());

/** Let detached background work settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("startAgentRun", () => {
  it("rejects an empty task", async () => {
    const res = await startAgentRun({ userId: "u1", task: "  " }, deps);
    expect(res).toEqual({ error: "task is required", status: 400 });
  });

  it("enforces the concurrency limit", async () => {
    listAgentRuns.mockResolvedValueOnce(
      Array.from({ length: MAX_CONCURRENT_RUNS }, () => ({ status: "running" })),
    );
    const res = await startAgentRun({ userId: "u1", task: "do it" }, deps);
    expect(res).toMatchObject({ status: 429 });
    expect(createAgentRun).not.toHaveBeenCalled();
  });

  it("surfaces a persistence failure", async () => {
    createAgentRun.mockResolvedValueOnce(null);
    const res = await startAgentRun({ userId: "u1", task: "do it" }, deps);
    expect(res).toEqual({ error: "Failed to create run record", status: 500 });
  });

  it("stamps routing up front and returns the run id", async () => {
    createAgentRun.mockResolvedValueOnce("run-1");
    runCodingAgent.mockResolvedValueOnce({
      status: "completed",
      summary: "done",
      steps: [],
      difficulty: "easy",
      tier: "haiku",
      model: "m",
      provider: "openrouter",
      sandboxId: "sb-1",
    });

    const res = await startAgentRun(
      { userId: "u1", task: "fix a typo in the readme" },
      deps,
    );
    expect(res).toEqual({ id: "run-1" });

    // Routing stamped before the loop produced steps.
    expect(updateAgentRun).toHaveBeenCalledWith("run-1", {
      difficulty: "easy",
      tier: "haiku",
      model: expect.any(String),
      provider: "openrouter",
    });

    await flush();
    // Terminal write recorded the completion.
    expect(updateAgentRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "completed", finished: true }),
    );
  });

  it("records an error when the run throws", async () => {
    createAgentRun.mockResolvedValueOnce("run-2");
    runCodingAgent.mockRejectedValueOnce(new Error("sandbox boom"));

    await startAgentRun({ userId: "u1", task: "build it" }, deps);
    await flush();

    expect(updateAgentRun).toHaveBeenCalledWith(
      "run-2",
      expect.objectContaining({ status: "error", finished: true }),
    );
  });
});
