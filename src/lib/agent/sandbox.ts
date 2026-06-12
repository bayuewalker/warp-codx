/**
 * Sandbox abstraction for the coding agent.
 *
 * The agent runs its tool loop against an isolated, ephemeral workspace: clone
 * a repo, read/write files, run commands, then push a branch. We hide the
 * concrete backend (Daytona today; Fly DIY or e2b possible later) behind this
 * interface so the loop, the tool dispatcher, and their tests never depend on a
 * specific SDK. The Daytona-backed implementation lives in `sandbox-daytona.ts`
 * and is only constructed at request time.
 */

export type ExecResult = {
  stdout: string;
  stderr: string;
  /** Process exit code; non-zero signals failure to the loop. */
  exitCode: number;
};

export type ExecOptions = {
  /** Working directory relative to the workspace root (default: root). */
  cwd?: string;
  /** Hard timeout — the backend kills the process and returns a non-zero code. */
  timeoutMs?: number;
};

/**
 * A live, isolated workspace. All paths are relative to the workspace root.
 * Implementations must be safe to call `destroy()` on more than once.
 *
 * The core read/write/exec surface is shared by both the ephemeral coding-agent
 * run (create → loop → destroy) and the persistent, browsable IDE workspace.
 * The lifecycle + preview methods are optional so a backend that can't keep a
 * box alive (or expose a port) still satisfies the agent contract.
 */
export interface Sandbox {
  /** Backend-assigned id (used in the run record + logs). */
  readonly id: string;
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  /** List entry names (not full paths) directly under `path`. */
  listDir(path: string): Promise<string[]>;
  /** Tear down the workspace. Idempotent; never throws on a double call. */
  destroy(): Promise<void>;

  // ── Persistent-workspace extensions (optional) ─────────────────────────────
  /** Ensure the box is running (resume if stopped). No-op if already up. */
  start?(): Promise<void>;
  /** Stop the box but keep its filesystem so it can be resumed later. */
  stop?(): Promise<void>;
  /** Current backend lifecycle state (e.g. "started", "stopped"), if known. */
  getState?(): Promise<string | undefined>;
  /**
   * Public URL that proxies `port` inside the sandbox to the browser — the
   * Replit "webview". `token` is the access token some backends require.
   */
  getPreviewUrl?(port: number): Promise<{ url: string; token?: string }>;
}

export type CreateSandboxOptions = {
  /** HTTPS repo URL to clone into the workspace (optional for a bare box). */
  repoUrl?: string;
  /** Branch to check out after clone. */
  branch?: string;
  /**
   * Token injected for git over HTTPS (clone private repos + push). Never
   * logged. Callers source this from a server-side secret.
   */
  gitToken?: string;
  /**
   * Persistent workspace: the box must survive teardown of the request that
   * created it (no `ephemeral`, no auto-delete) so the IDE can reconnect to it
   * across sessions. The ephemeral agent run leaves this false.
   */
  persistent?: boolean;
};

/** Factory for {@link Sandbox} instances — one provider per backend. */
export interface SandboxProvider {
  readonly name: string;
  create(opts?: CreateSandboxOptions): Promise<Sandbox>;
  /**
   * Reattach to an already-running (or stopped) box by id — the foundation of
   * the persistent IDE workspace, which stores the id and reconnects on each
   * request rather than holding the handle in memory. Optional: a backend with
   * no durable boxes omits it.
   */
  connect?(id: string): Promise<Sandbox>;
}
