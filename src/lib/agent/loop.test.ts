/**
 * Tests for the agent tool loop. A scripted LlmClient + in-memory fake Sandbox
 * drive the full ReAct cycle deterministically: tool execution + result
 * feedback, the `finish` terminal path, the no-tool-call completion path, the
 * step cap, malformed-argument tolerance, the onStep stream, and LLM-error
 * handling.
 */
import { describe, expect, it, vi } from "vitest";
import type { ExecResult, Sandbox } from "./sandbox";
import {
  runAgentLoop,
  type AssistantTurn,
  type ChatMessage,
  type LlmClient,
  type ToolCall,
} from "./loop";

class FakeSandbox implements Sandbox {
  readonly id = "fake";
  files = new Map<string, string>();
  async exec(): Promise<ExecResult> {
    return { stdout: "ok", stderr: "", exitCode: 0 };
  }
  async readFile(p: string): Promise<string> {
    if (!this.files.has(p)) throw new Error(`ENOENT: ${p}`);
    return this.files.get(p)!;
  }
  async writeFile(p: string, c: string): Promise<void> {
    this.files.set(p, c);
  }
  async listDir(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async destroy(): Promise<void> {}
}

const tc = (id: string, name: string, args: object): ToolCall => ({
  id,
  name,
  arguments: JSON.stringify(args),
});

/** Build an LlmClient that returns the given turns in sequence. */
function scriptedLlm(turns: AssistantTurn[]): LlmClient {
  let i = 0;
  return vi.fn(async () => turns[i++] ?? { content: "fallback", toolCalls: [] });
}

const SYS = "You are a coding agent.";

describe("runAgentLoop", () => {
  it("executes a tool then finishes, feeding tool results back to the model", async () => {
    const sandbox = new FakeSandbox();
    const seen: ChatMessage[][] = [];
    const llm: LlmClient = vi.fn(async (messages) => {
      seen.push(structuredClone(messages));
      if (seen.length === 1) {
        return {
          content: "writing file",
          toolCalls: [tc("c1", "write_file", { path: "x.txt", content: "hi" })],
        };
      }
      return {
        content: null,
        toolCalls: [tc("c2", "finish", { summary: "wrote x.txt" })],
      };
    });

    const res = await runAgentLoop({ task: "make x.txt", system: SYS, llm, sandbox });

    expect(res.status).toBe("completed");
    expect(res.summary).toBe("wrote x.txt");
    expect(res.steps).toHaveLength(2);
    expect(sandbox.files.get("x.txt")).toBe("hi");
    // Second LLM call must include the tool result message from step 1.
    const secondCallMessages = seen[1];
    expect(secondCallMessages.some((m) => m.role === "tool")).toBe(true);
  });

  it("completes when the model replies with no tool calls", async () => {
    const sandbox = new FakeSandbox();
    const llm = scriptedLlm([{ content: "Nothing to do.", toolCalls: [] }]);
    const res = await runAgentLoop({ task: "noop", system: SYS, llm, sandbox });
    expect(res.status).toBe("completed");
    expect(res.summary).toBe("Nothing to do.");
    expect(res.steps).toHaveLength(1);
  });

  it("stops at the step cap and reports max_steps", async () => {
    const sandbox = new FakeSandbox();
    // Always calls a non-terminal tool → never finishes.
    const llm: LlmClient = vi.fn(async () => ({
      content: "looping",
      toolCalls: [tc("c", "list_dir", { path: "." })],
    }));
    const res = await runAgentLoop({
      task: "spin",
      system: SYS,
      llm,
      sandbox,
      maxSteps: 3,
    });
    expect(res.status).toBe("max_steps");
    expect(res.steps).toHaveLength(3);
    expect(llm).toHaveBeenCalledTimes(3);
  });

  it("tolerates malformed tool arguments without throwing", async () => {
    const sandbox = new FakeSandbox();
    const badCall: ToolCall = { id: "c1", name: "list_dir", arguments: "{not json" };
    const llm = scriptedLlm([
      { content: null, toolCalls: [badCall] },
      { content: null, toolCalls: [tc("c2", "finish", { summary: "ok" })] },
    ]);
    const res = await runAgentLoop({ task: "t", system: SYS, llm, sandbox });
    expect(res.status).toBe("completed");
    expect(res.steps[0].executions[0].ok).toBe(true); // list_dir on '.' fallback
  });

  it("streams each step via onStep", async () => {
    const sandbox = new FakeSandbox();
    const onStep = vi.fn();
    const llm = scriptedLlm([
      { content: "step1", toolCalls: [tc("c1", "list_dir", { path: "." })] },
      { content: null, toolCalls: [tc("c2", "finish", { summary: "done" })] },
    ]);
    await runAgentLoop({ task: "t", system: SYS, llm, sandbox, onStep });
    expect(onStep).toHaveBeenCalledTimes(2);
    expect(onStep.mock.calls[0][0].index).toBe(0);
  });

  it("returns status:error when the LLM client throws", async () => {
    const sandbox = new FakeSandbox();
    const llm: LlmClient = vi.fn(async () => {
      throw new Error("rate limited");
    });
    const res = await runAgentLoop({ task: "t", system: SYS, llm, sandbox });
    expect(res.status).toBe("error");
    expect(res.summary).toContain("rate limited");
  });
});
