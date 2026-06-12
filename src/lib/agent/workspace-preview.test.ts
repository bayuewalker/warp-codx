import { describe, it, expect, vi } from "vitest";
import {
  buildDetachedCommand,
  shellQuote,
  startPreview,
  PREVIEW_LOG_PATH,
} from "./workspace-preview";
import type { Sandbox } from "./sandbox";

describe("shellQuote", () => {
  it("wraps in single quotes", () => {
    expect(shellQuote("npm run dev")).toBe("'npm run dev'");
  });
  it("escapes embedded single quotes", () => {
    expect(shellQuote("echo 'hi'")).toBe(`'echo '\\''hi'\\'''`);
  });
});

describe("buildDetachedCommand", () => {
  it("backgrounds the command under nohup and tees to the log", () => {
    const cmd = buildDetachedCommand("npm run dev");
    expect(cmd).toContain("nohup sh -c 'npm run dev'");
    expect(cmd).toContain(`> ${PREVIEW_LOG_PATH} 2>&1 &`);
    expect(cmd).toContain("echo");
  });
});

describe("startPreview", () => {
  function sandbox(overrides: Partial<Sandbox> = {}): Sandbox {
    return {
      id: "b1",
      exec: vi.fn(async () => ({ stdout: "started: pid 42", stderr: "", exitCode: 0 })),
      readFile: vi.fn(async () => ""),
      writeFile: vi.fn(async () => {}),
      listDir: vi.fn(async () => []),
      destroy: vi.fn(async () => {}),
      getPreviewUrl: vi.fn(async () => ({ url: "https://3000-b1.preview", token: "t" })),
      ...overrides,
    };
  }

  it("launches detached and resolves the preview URL", async () => {
    const box = sandbox();
    const res = await startPreview(box, { command: "npm run dev", port: 3000 });
    expect(box.exec).toHaveBeenCalled();
    expect(res.url).toBe("https://3000-b1.preview");
    expect(res.port).toBe(3000);
  });

  it("returns url:null when the backend can't proxy a port", async () => {
    const box = sandbox({ getPreviewUrl: undefined });
    const res = await startPreview(box, { command: "npm run dev", port: 3000 });
    expect(res.url).toBeNull();
  });

  it("swallows preview-url errors but still reports the launch", async () => {
    const box = sandbox({
      getPreviewUrl: vi.fn(async () => {
        throw new Error("port not bound");
      }),
    });
    const res = await startPreview(box, { command: "npm run dev", port: 3000 });
    expect(res.url).toBeNull();
    expect(res.launchOutput).toContain("started");
  });
});
