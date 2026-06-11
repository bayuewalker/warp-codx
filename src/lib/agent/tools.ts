/**
 * Agent tool registry + dispatcher.
 *
 * Tools are declared in OpenAI function-calling shape because all three
 * providers (OpenRouter / OpenAI / Blackbox) speak the OpenAI chat-completions
 * API, so the loop can pass `AGENT_TOOLS` straight through as `tools`. The
 * dispatcher maps a tool call onto {@link Sandbox} operations and always
 * resolves to a string (errors included) so the loop can feed the result back
 * to the model as the next `tool` message rather than throwing.
 */
import type { Sandbox } from "./sandbox";

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a UTF-8 text file from the workspace. Returns the full file contents.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to repo root." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or overwrite a text file in the workspace with the given contents.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to repo root." },
          content: { type: "string", description: "Full file contents to write." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List entry names directly under a directory in the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path relative to repo root (use '.' for root).",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run a shell command in the workspace (build, test, lint, git, etc.). " +
        "Returns combined stdout/stderr and the exit code.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute." },
          cwd: {
            type: "string",
            description: "Optional working directory relative to repo root.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description:
        "Call when the task is complete. Provide a short summary of what was " +
        "changed; the loop stops after this.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "What was accomplished." },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    },
  },
];

/** Names the loop treats as terminal (no further tool turns expected). */
export const TERMINAL_TOOLS = new Set(["finish"]);

/** Cap tool output fed back to the model so a noisy command can't blow context. */
export const MAX_TOOL_OUTPUT = 16_000;

export type ToolCallResult = {
  /** String fed back to the model as the tool message content. */
  output: string;
  /** False when the tool errored or a command exited non-zero. */
  ok: boolean;
};

function truncate(s: string): string {
  if (s.length <= MAX_TOOL_OUTPUT) return s;
  const head = s.slice(0, MAX_TOOL_OUTPUT);
  return `${head}\n…[truncated ${s.length - MAX_TOOL_OUTPUT} chars]`;
}

/**
 * Execute one tool call against the sandbox. `args` is the already-parsed tool
 * arguments object. Never throws — failures are returned as `{ ok: false }`
 * with the error text as output.
 */
export async function dispatchToolCall(
  sandbox: Sandbox,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    switch (name) {
      case "read_file": {
        const content = await sandbox.readFile(String(args.path));
        return { ok: true, output: truncate(content) };
      }
      case "write_file": {
        await sandbox.writeFile(String(args.path), String(args.content ?? ""));
        return { ok: true, output: `Wrote ${String(args.path)}.` };
      }
      case "list_dir": {
        const entries = await sandbox.listDir(String(args.path));
        return { ok: true, output: truncate(entries.join("\n")) };
      }
      case "run_command": {
        const res = await sandbox.exec(String(args.command), {
          cwd: args.cwd ? String(args.cwd) : undefined,
        });
        const body =
          (res.stdout ? res.stdout : "") +
          (res.stderr ? `\n${res.stderr}` : "");
        return {
          ok: res.exitCode === 0,
          output: truncate(
            `exit ${res.exitCode}\n${body}`.trim(),
          ),
        };
      }
      case "finish": {
        return { ok: true, output: String(args.summary ?? "Done.") };
      }
      default:
        return { ok: false, output: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, output: `Tool ${name} failed: ${msg}` };
  }
}
