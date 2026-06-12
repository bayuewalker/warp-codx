/**
 * Workspace preview (the Replit "webview").
 *
 * Starting a dev server is fundamentally different from the agent's one-shot
 * commands: it must keep running *after* the request returns. So we launch it
 * detached (nohup + background) with its output teed to a log the terminal can
 * tail, then ask the sandbox for the public URL that proxies the server's port.
 *
 * `buildDetachedCommand` is pure so the launch shape is unit-testable without a
 * live sandbox.
 */
import type { Sandbox } from "./sandbox";

/** Where a detached preview server's combined output is teed inside the box. */
export const PREVIEW_LOG_PATH = "/tmp/warp-preview.log";

/** Default dev-server port if the caller doesn't specify one. */
export const DEFAULT_PREVIEW_PORT = 3000;

/**
 * Wrap a command so it survives the request: run under `nohup` in the
 * background, redirecting stdout+stderr to the preview log. The trailing
 * `echo` returns immediately so the exec call doesn't block on the server.
 */
export function buildDetachedCommand(
  command: string,
  logPath: string = PREVIEW_LOG_PATH,
): string {
  const trimmed = command.trim();
  return (
    `nohup sh -c ${shellQuote(trimmed)} > ${logPath} 2>&1 &\n` +
    `echo "started: pid $!"`
  );
}

/** Single-quote a string for POSIX sh, escaping embedded single quotes. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export type StartPreviewInput = {
  /** Command that starts the dev server (e.g. `npm run dev`). */
  command: string;
  /** Port the server listens on inside the sandbox. */
  port: number;
};

export type StartPreviewResult = {
  port: number;
  url: string | null;
  token?: string;
  /** First lines of the detached launch (the `started: pid N` echo). */
  launchOutput: string;
};

/**
 * Launch the dev server detached and resolve its public preview URL. Never
 * throws on the preview-URL lookup — a backend without port proxying still
 * starts the server and returns `url: null` so the caller can surface a hint.
 */
export async function startPreview(
  sandbox: Sandbox,
  input: StartPreviewInput,
): Promise<StartPreviewResult> {
  const launch = await sandbox.exec(buildDetachedCommand(input.command), {
    // The wrapper backgrounds the server and returns at once; keep a short
    // ceiling so a mis-typed command can't wedge the request.
    timeoutMs: 15_000,
  });

  let url: string | null = null;
  let token: string | undefined;
  if (sandbox.getPreviewUrl) {
    try {
      const preview = await sandbox.getPreviewUrl(input.port);
      url = preview.url;
      token = preview.token;
    } catch {
      /* port not yet bound / backend can't proxy — leave url null */
    }
  }

  return {
    port: input.port,
    url,
    token,
    launchOutput: launch.stdout || launch.stderr || "",
  };
}
