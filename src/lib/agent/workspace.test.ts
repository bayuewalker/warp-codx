/**
 * Tests for the persistent workspace service: create-vs-reconnect routing,
 * stale-box fallback, stop/destroy, and the not-ready guard — all against a
 * fake SandboxProvider with the store mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getWorkspaceRecord, upsertWorkspaceRecord, deleteWorkspaceRecord } =
  vi.hoisted(() => ({
    getWorkspaceRecord: vi.fn(),
    upsertWorkspaceRecord: vi.fn(async () => null),
    deleteWorkspaceRecord: vi.fn(async () => {}),
  }));

vi.mock("./workspace-store", () => ({
  getWorkspaceRecord,
  upsertWorkspaceRecord,
  deleteWorkspaceRecord,
}));

import {
  connectSandbox,
  destroyWorkspace,
  ensureWorkspace,
  stopWorkspace,
  WorkspaceNotReadyError,
} from "./workspace";
import type { Sandbox, SandboxProvider } from "./sandbox";

function fakeSandbox(id: string): Sandbox {
  return {
    id,
    exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    readFile: vi.fn(async () => ""),
    writeFile: vi.fn(async () => {}),
    listDir: vi.fn(async () => []),
    destroy: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
}

function fakeProvider(overrides: Partial<SandboxProvider> = {}): SandboxProvider {
  return {
    name: "fake",
    create: vi.fn(async () => fakeSandbox("box-new")),
    connect: vi.fn(async (id: string) => fakeSandbox(id)),
    ...overrides,
  };
}

beforeEach(() => {
  getWorkspaceRecord.mockReset().mockResolvedValue(null);
  upsertWorkspaceRecord.mockReset().mockResolvedValue(null);
  deleteWorkspaceRecord.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe("ensureWorkspace", () => {
  it("creates a persistent box on first use", async () => {
    const provider = fakeProvider();
    const { sandbox } = await ensureWorkspace(
      { userId: "u1", repoUrl: "https://github.com/o/r" },
      { provider },
    );
    expect(sandbox.id).toBe("box-new");
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({ persistent: true, repoUrl: "https://github.com/o/r" }),
    );
    expect(provider.connect).not.toHaveBeenCalled();
  });

  it("reconnects to an existing box instead of creating", async () => {
    getWorkspaceRecord.mockResolvedValue({ sandbox_id: "box-123", status: "stopped" });
    const provider = fakeProvider();
    const { sandbox } = await ensureWorkspace({ userId: "u1" }, { provider });
    expect(sandbox.id).toBe("box-123");
    expect(provider.connect).toHaveBeenCalledWith("box-123");
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("falls back to create when the stored box is gone", async () => {
    getWorkspaceRecord.mockResolvedValue({ sandbox_id: "dead", status: "running" });
    const provider = fakeProvider({
      connect: vi.fn(async () => {
        throw new Error("404 sandbox not found");
      }),
    });
    const { sandbox } = await ensureWorkspace({ userId: "u1" }, { provider });
    expect(sandbox.id).toBe("box-new");
    expect(provider.create).toHaveBeenCalled();
  });

  it("marks the record errored and rethrows when create fails", async () => {
    const provider = fakeProvider({
      create: vi.fn(async () => {
        throw new Error("daytona down");
      }),
    });
    await expect(ensureWorkspace({ userId: "u1" }, { provider })).rejects.toThrow(
      "daytona down",
    );
    expect(upsertWorkspaceRecord).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ status: "error" }),
    );
  });
});

describe("connectSandbox", () => {
  it("throws WorkspaceNotReadyError when no workspace exists", async () => {
    await expect(connectSandbox("u1", { provider: fakeProvider() })).rejects.toBeInstanceOf(
      WorkspaceNotReadyError,
    );
  });

  it("reconnects to the stored box", async () => {
    getWorkspaceRecord.mockResolvedValue({ sandbox_id: "box-7", status: "running" });
    const sandbox = await connectSandbox("u1", { provider: fakeProvider() });
    expect(sandbox.id).toBe("box-7");
  });
});

describe("stopWorkspace / destroyWorkspace", () => {
  it("stops the box and marks the record stopped", async () => {
    getWorkspaceRecord.mockResolvedValue({ sandbox_id: "box-7", status: "running" });
    const sandbox = fakeSandbox("box-7");
    const provider = fakeProvider({ connect: vi.fn(async () => sandbox) });
    await stopWorkspace("u1", { provider });
    expect(sandbox.stop).toHaveBeenCalled();
    expect(upsertWorkspaceRecord).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ status: "stopped" }),
    );
  });

  it("destroys the box and deletes the mapping", async () => {
    getWorkspaceRecord.mockResolvedValue({ sandbox_id: "box-7", status: "running" });
    const sandbox = fakeSandbox("box-7");
    const provider = fakeProvider({ connect: vi.fn(async () => sandbox) });
    await destroyWorkspace("u1", { provider });
    expect(sandbox.destroy).toHaveBeenCalled();
    expect(deleteWorkspaceRecord).toHaveBeenCalledWith("u1");
  });
});
