/**
 * Tests for the Daytona sandbox adapter: path translation, exec mapping, clone
 * wiring, and teardown. The SDK is mocked so these run without Daytona creds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { DaytonaCtor, create } = vi.hoisted(() => ({
  DaytonaCtor: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@daytonaio/sdk", () => ({
  Daytona: class {
    create = create;
    constructor(cfg: unknown) {
      DaytonaCtor(cfg);
    }
  },
}));

import { daytonaSandboxProvider, readDaytonaConfig } from "./sandbox-daytona";

/** Build a fake Daytona box with spy-backed fs/process/git. */
function fakeBox() {
  return {
    id: "box-123",
    getUserRootDir: vi.fn(async () => "/home/daytona"),
    process: { executeCommand: vi.fn(async () => ({ exitCode: 0, result: "ok" })) },
    fs: {
      downloadFile: vi.fn(async () => Buffer.from("file body", "utf8")),
      uploadFile: vi.fn(async () => {}),
      listFiles: vi.fn(async () => [
        { name: "src", isDir: true },
        { name: "package.json", isDir: false },
      ]),
    },
    git: { clone: vi.fn(async () => {}) },
    delete: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  DaytonaCtor.mockReset();
  create.mockReset();
  delete process.env.DAYTONA_API_KEY;
  delete process.env.DAYTONA_API_URL;
});
afterEach(() => vi.clearAllMocks());

describe("readDaytonaConfig", () => {
  it("returns null when no key is set", () => {
    expect(readDaytonaConfig()).toBeNull();
  });
  it("reads key + optional url", () => {
    process.env.DAYTONA_API_KEY = "dtn_key";
    process.env.DAYTONA_API_URL = "https://api.example.com";
    expect(readDaytonaConfig()).toEqual({
      apiKey: "dtn_key",
      apiUrl: "https://api.example.com",
    });
  });
});

describe("daytonaSandboxProvider", () => {
  it("throws a clear error when Daytona is not configured", async () => {
    await expect(daytonaSandboxProvider.create()).rejects.toThrow(/not configured/i);
  });

  it("clones the repo with token auth and exposes the box id", async () => {
    process.env.DAYTONA_API_KEY = "dtn_key";
    const box = fakeBox();
    create.mockResolvedValueOnce(box);

    const sb = await daytonaSandboxProvider.create({
      repoUrl: "https://github.com/o/r.git",
      branch: "main",
      gitToken: "ghp_secret",
    });

    expect(sb.id).toBe("box-123");
    // setupGitAuth wrote a credential file (token kept out of command args).
    expect(box.fs.uploadFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      ".git-credentials",
    );
    expect(box.git.clone).toHaveBeenCalledWith(
      "https://github.com/o/r.git",
      "repo",
      "main",
      undefined,
      "x-access-token",
      "ghp_secret",
    );
  });

  it("does not clone when no repoUrl is given", async () => {
    process.env.DAYTONA_API_KEY = "dtn_key";
    const box = fakeBox();
    create.mockResolvedValueOnce(box);

    await daytonaSandboxProvider.create();
    expect(box.git.clone).not.toHaveBeenCalled();
  });

  it("tears down the box if init fails after creation", async () => {
    process.env.DAYTONA_API_KEY = "dtn_key";
    const box = fakeBox();
    box.git.clone.mockRejectedValueOnce(new Error("clone failed"));
    create.mockResolvedValueOnce(box);

    await expect(
      daytonaSandboxProvider.create({ repoUrl: "https://github.com/o/r.git" }),
    ).rejects.toThrow("clone failed");
    expect(box.delete).toHaveBeenCalled();
  });
});

describe("DaytonaWorkspace operations", () => {
  async function makeWorkspace() {
    process.env.DAYTONA_API_KEY = "dtn_key";
    const box = fakeBox();
    create.mockResolvedValueOnce(box);
    const sb = await daytonaSandboxProvider.create({
      repoUrl: "https://github.com/o/r.git",
    });
    return { box, sb };
  }

  it("translates relative paths under repo/ for fs ops", async () => {
    const { box, sb } = await makeWorkspace();

    await sb.readFile("src/index.ts");
    expect(box.fs.downloadFile).toHaveBeenCalledWith("repo/src/index.ts");

    await sb.writeFile("src/new.ts", "hi");
    expect(box.fs.uploadFile).toHaveBeenLastCalledWith(
      expect.any(Buffer),
      "repo/src/new.ts",
    );
  });

  it("lists dir entries, marking directories with a trailing slash", async () => {
    const { sb } = await makeWorkspace();
    const entries = await sb.listDir(".");
    expect(entries).toEqual(["src/", "package.json"]);
  });

  it("runs commands in the repo dir and maps the result", async () => {
    const { box, sb } = await makeWorkspace();
    const res = await sb.exec("ls", { cwd: "src" });
    expect(box.process.executeCommand).toHaveBeenLastCalledWith(
      "ls",
      "/home/daytona/repo/src",
      undefined,
      300,
    );
    expect(res).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
  });

  it("destroy is idempotent", async () => {
    const { box, sb } = await makeWorkspace();
    await sb.destroy();
    await sb.destroy();
    expect(box.delete).toHaveBeenCalledTimes(1);
  });
});
