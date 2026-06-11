/**
 * Tests for the agent tool dispatcher. Uses an in-memory fake Sandbox so the
 * file/command mapping, the exit-code → ok flag, output truncation, and the
 * never-throws error contract are all exercised without a real backend.
 */
import { describe, expect, it } from "vitest";
import type { ExecResult, Sandbox } from "./sandbox";
import {
  AGENT_TOOLS,
  dispatchToolCall,
  MAX_TOOL_OUTPUT,
  TERMINAL_TOOLS,
} from "./tools";

class FakeSandbox implements Sandbox {
  readonly id = "fake-1";
  files = new Map<string, string>();
  /** Optional scripted exec handler; defaults to a clean exit. */
  execImpl: (cmd: string) => ExecResult = () => ({
    stdout: "ok",
    stderr: "",
    exitCode: 0,
  });

  async exec(command: string): Promise<ExecResult> {
    return this.execImpl(command);
  }
  async readFile(path: string): Promise<string> {
    if (!this.files.has(path)) throw new Error(`ENOENT: ${path}`);
    return this.files.get(path)!;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async listDir(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async destroy(): Promise<void> {}
}

describe("AGENT_TOOLS", () => {
  it("declares the expected tool surface in OpenAI shape", () => {
    const names = AGENT_TOOLS.map((t) => t.function.name);
    expect(names).toEqual([
      "read_file",
      "write_file",
      "list_dir",
      "run_command",
      "finish",
    ]);
    for (const t of AGENT_TOOLS) {
      expect(t.type).toBe("function");
      expect(t.function.parameters).toHaveProperty("type", "object");
    }
    expect(TERMINAL_TOOLS.has("finish")).toBe(true);
  });
});

describe("dispatchToolCall", () => {
  it("writes then reads a file round-trip", async () => {
    const sb = new FakeSandbox();
    const w = await dispatchToolCall(sb, "write_file", {
      path: "a.txt",
      content: "hello",
    });
    expect(w.ok).toBe(true);
    const r = await dispatchToolCall(sb, "read_file", { path: "a.txt" });
    expect(r).toEqual({ ok: true, output: "hello" });
  });

  it("maps a clean command to ok:true and includes the exit code", async () => {
    const sb = new FakeSandbox();
    sb.execImpl = () => ({ stdout: "built", stderr: "", exitCode: 0 });
    const res = await dispatchToolCall(sb, "run_command", { command: "make" });
    expect(res.ok).toBe(true);
    expect(res.output).toContain("exit 0");
    expect(res.output).toContain("built");
  });

  it("flags a non-zero command exit as ok:false", async () => {
    const sb = new FakeSandbox();
    sb.execImpl = () => ({ stdout: "", stderr: "boom", exitCode: 1 });
    const res = await dispatchToolCall(sb, "run_command", { command: "test" });
    expect(res.ok).toBe(false);
    expect(res.output).toContain("exit 1");
    expect(res.output).toContain("boom");
  });

  it("never throws — a backend error becomes ok:false output", async () => {
    const sb = new FakeSandbox();
    const res = await dispatchToolCall(sb, "read_file", { path: "missing" });
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/failed|ENOENT/i);
  });

  it("rejects an unknown tool name without throwing", async () => {
    const sb = new FakeSandbox();
    const res = await dispatchToolCall(sb, "rm_rf", {});
    expect(res.ok).toBe(false);
    expect(res.output).toContain("Unknown tool");
  });

  it("truncates oversized output", async () => {
    const sb = new FakeSandbox();
    await sb.writeFile("big.txt", "x".repeat(MAX_TOOL_OUTPUT + 500));
    const res = await dispatchToolCall(sb, "read_file", { path: "big.txt" });
    expect(res.ok).toBe(true);
    expect(res.output).toContain("[truncated");
    expect(res.output.length).toBeLessThan(MAX_TOOL_OUTPUT + 200);
  });

  it("finish returns the summary", async () => {
    const sb = new FakeSandbox();
    const res = await dispatchToolCall(sb, "finish", { summary: "all green" });
    expect(res).toEqual({ ok: true, output: "all green" });
  });
});
