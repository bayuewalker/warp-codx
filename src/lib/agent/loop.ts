/**
 * Agent tool loop — the ReAct cycle that drives the coding agent.
 *
 * Given a task, it alternates: ask the model (with {@link AGENT_TOOLS}),
 * execute any tool calls against the {@link Sandbox}, feed results back, repeat
 * — until the model calls `finish`, replies with no tool calls, or the step cap
 * is hit. The LLM is injected as {@link LlmClient} so the loop stays pure and
 * fully unit-testable; the real client wraps the provider in `llm-client.ts`.
 */
import type { Sandbox } from "./sandbox";
import {
  AGENT_TOOLS,
  dispatchToolCall,
  TERMINAL_TOOLS,
  type ToolDefinition,
} from "./tools";

export type ToolCall = {
  id: string;
  name: string;
  /** Raw JSON string of arguments as emitted by the model. */
  arguments: string;
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** One model turn: optional prose plus zero or more tool calls. */
export type AssistantTurn = {
  content: string | null;
  toolCalls: ToolCall[];
};

export type LlmClient = (
  messages: ChatMessage[],
  tools: ToolDefinition[],
) => Promise<AssistantTurn>;

export type ToolExecution = {
  call: ToolCall;
  output: string;
  ok: boolean;
};

export type AgentStep = {
  /** 0-based step index. */
  index: number;
  /** Model prose for this step (may be null when it only called tools). */
  thought: string | null;
  /** Tool calls executed this step, with their results. */
  executions: ToolExecution[];
};

export type RunStatus = "completed" | "max_steps" | "error";

export type RunResult = {
  status: RunStatus;
  /** Final summary (finish summary, trailing prose, or error message). */
  summary: string;
  steps: AgentStep[];
};

export type RunAgentOptions = {
  task: string;
  /** System prompt establishing the agent's role + the workspace contract. */
  system: string;
  llm: LlmClient;
  sandbox: Sandbox;
  /** Hard cap on model turns (cost/runaway guard). Default 20. */
  maxSteps?: number;
  /** Called after each completed step — used to stream progress to the UI. */
  onStep?: (step: AgentStep) => void;
};

const DEFAULT_MAX_STEPS = 20;

/** Parse tool arguments defensively — malformed JSON yields an empty object. */
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Run the agent loop to completion (or until the step cap). Resolves with the
 * status, a summary, and the full step transcript. Errors thrown by the LLM
 * client are caught and returned as `status: "error"` so a run never rejects.
 */
export async function runAgentLoop(opts: RunAgentOptions): Promise<RunResult> {
  const { task, system, llm, sandbox, onStep } = opts;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: task },
  ];
  const steps: AgentStep[] = [];

  for (let index = 0; index < maxSteps; index++) {
    let turn: AssistantTurn;
    try {
      turn = await llm(messages, AGENT_TOOLS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", summary: `LLM error: ${msg}`, steps };
    }

    messages.push({
      role: "assistant",
      content: turn.content,
      tool_calls: turn.toolCalls.length ? turn.toolCalls : undefined,
    });

    // No tool calls → the model is done; its prose is the summary.
    if (turn.toolCalls.length === 0) {
      const summary = turn.content?.trim() || "Done.";
      steps.push({ index, thought: turn.content, executions: [] });
      onStep?.(steps[steps.length - 1]);
      return { status: "completed", summary, steps };
    }

    const executions: ToolExecution[] = [];
    let finishSummary: string | null = null;

    for (const call of turn.toolCalls) {
      const args = parseArgs(call.arguments);
      const result = await dispatchToolCall(sandbox, call.name, args);
      executions.push({ call, output: result.output, ok: result.ok });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result.output,
      });
      if (TERMINAL_TOOLS.has(call.name)) {
        finishSummary = result.output;
      }
    }

    const step: AgentStep = { index, thought: turn.content, executions };
    steps.push(step);
    onStep?.(step);

    if (finishSummary !== null) {
      return { status: "completed", summary: finishSummary, steps };
    }
  }

  return {
    status: "max_steps",
    summary: `Stopped after ${maxSteps} steps without finishing.`,
    steps,
  };
}
