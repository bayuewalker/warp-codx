/**
 * Daytona-backed {@link SandboxProvider}.
 *
 * Maps the backend-agnostic {@link Sandbox} contract onto the `@daytonaio/sdk`:
 * a Daytona sandbox is an ephemeral cloud workspace, into which we clone the
 * target repo and then read/write/exec. The rest of the agent (loop, tools,
 * tests) never imports this file — it's constructed only at request time via
 * {@link daytonaSandboxProvider}, so a deployment without Daytona configured
 * still builds and runs its unit tests.
 *
 * Path model: everything the agent sees is relative to the cloned repo. We
 * clone into a fixed `repo/` subdir under the sandbox's root and translate the
 * agent's relative paths against it, so the model can say `src/index.ts` and we
 * resolve the real location.
 *
 * Auth: the injected git token is written to a credential-store file (never
 * passed on a command line, never logged) so both the initial clone and any
 * later `git push` the agent runs authenticate transparently.
 */
import { Daytona, type Sandbox as DaytonaSandbox } from "@daytonaio/sdk";
import type {
  CreateSandboxOptions,
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxProvider,
} from "./sandbox";

/** Subdir (under the sandbox root) the repo is cloned into. */
const WORKSPACE_SUBDIR = "repo";
/** Default per-command timeout if the caller doesn't set one (seconds). */
const DEFAULT_EXEC_TIMEOUT_S = 300;
/** Idle minutes before Daytona auto-stops the box (a cost backstop). */
const AUTO_STOP_MINUTES = 15;

/** Join path segments, dropping empty/`.` parts and preserving a leading `/`. */
function joinPath(...parts: (string | undefined)[]): string {
  const first = parts.find((p): p is string => !!p && p !== ".");
  const absolute = !!first && first.startsWith("/");
  const body = parts
    .filter((p): p is string => !!p && p !== ".")
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return absolute ? `/${body}` : body;
}

/**
 * Read the Daytona credentials from the environment. Returns null when not
 * configured so callers can fail with a clear, actionable message rather than
 * the SDK's opaque error.
 */
export function readDaytonaConfig(): { apiKey: string; apiUrl?: string } | null {
  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  if (!apiKey) return null;
  const apiUrl = process.env.DAYTONA_API_URL?.trim() || undefined;
  return { apiKey, apiUrl };
}

/** {@link Sandbox} backed by one live Daytona workspace. */
class DaytonaWorkspace implements Sandbox {
  readonly id: string;
  private destroyed = false;

  constructor(
    private readonly box: DaytonaSandbox,
    /** Absolute path of the cloned repo inside the sandbox. */
    private readonly repoDir: string,
  ) {
    this.id = box.id;
  }

  /** Map an agent-relative path to a sandbox-root-relative one (`repo/…`). */
  private fsPath(path: string): string {
    return joinPath(WORKSPACE_SUBDIR, path);
  }

  async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    const cwd = opts?.cwd ? joinPath(this.repoDir, opts.cwd) : this.repoDir;
    const timeoutS = opts?.timeoutMs
      ? Math.ceil(opts.timeoutMs / 1000)
      : DEFAULT_EXEC_TIMEOUT_S;
    const res = await this.box.process.executeCommand(
      command,
      cwd,
      undefined,
      timeoutS,
    );
    // Daytona merges stdout+stderr into `result`; surface it as stdout and
    // leave stderr empty (the tool layer concatenates both anyway).
    return { stdout: res.result ?? "", stderr: "", exitCode: res.exitCode ?? 0 };
  }

  async readFile(path: string): Promise<string> {
    const buf = await this.box.fs.downloadFile(this.fsPath(path));
    return buf.toString("utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.box.fs.uploadFile(Buffer.from(content, "utf8"), this.fsPath(path));
  }

  async listDir(path: string): Promise<string[]> {
    const entries = await this.box.fs.listFiles(this.fsPath(path));
    return entries.map((e) => (e.isDir ? `${e.name}/` : e.name));
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      await this.box.delete();
    } catch {
      // Best-effort teardown; the auto-stop/auto-delete interval is the
      // backstop if the API call fails (e.g. the box is already gone).
    }
  }

  /** Resume a stopped box so file/exec/preview calls hit a running runner. */
  async start(): Promise<void> {
    try {
      await this.box.refreshData();
      if (this.box.state === "started") return;
    } catch {
      // refreshData is best-effort; fall through and attempt start anyway.
    }
    await this.box.start();
  }

  /** Stop the box but keep its filesystem so the IDE can resume it later. */
  async stop(): Promise<void> {
    await this.box.stop();
  }

  async getState(): Promise<string | undefined> {
    try {
      await this.box.refreshData();
    } catch {
      /* return the last-known state if the refresh fails */
    }
    return this.box.state;
  }

  /** Map a sandbox port to a public preview URL (the Replit webview). */
  async getPreviewUrl(port: number): Promise<{ url: string; token?: string }> {
    const link = await this.box.getPreviewLink(port);
    return { url: link.url, token: link.token };
  }
}

/**
 * Configure git inside a fresh sandbox so clone + push authenticate without the
 * token ever touching a command line. Writes a credential-store file and points
 * git at it. `root` is the sandbox's absolute root dir.
 */
async function setupGitAuth(
  box: DaytonaSandbox,
  token: string,
): Promise<void> {
  // x-access-token is GitHub's username convention for token auth (works for
  // both PATs and App installation tokens).
  const line = `https://x-access-token:${token}@github.com\n`;
  await box.fs.uploadFile(Buffer.from(line, "utf8"), ".git-credentials");
  await box.process.executeCommand(
    "git config --global credential.helper store && " +
      "git config --global user.email 'agent@warp-codx.local' && " +
      "git config --global user.name 'WARP CodX Agent'",
  );
}

/**
 * Create + initialize one Daytona workspace: spin up the box, optionally clone
 * the repo (with auth), and return the {@link Sandbox} wrapper. On any failure
 * after the box exists, it's torn down before rethrowing so we never leak a
 * running sandbox.
 */
async function createDaytonaSandbox(
  daytona: Daytona,
  opts: CreateSandboxOptions | undefined,
): Promise<Sandbox> {
  // A persistent IDE workspace must outlive the request that creates it: no
  // ephemeral flag (which forces auto-delete on stop) and auto-delete disabled,
  // so a reconnect later finds the filesystem intact. Auto-stop still applies
  // as an idle cost backstop — the IDE resumes the box on the next request.
  const box = await daytona.create({
    language: "typescript",
    autoStopInterval: AUTO_STOP_MINUTES,
    ...(opts?.persistent
      ? { ephemeral: false, autoDeleteInterval: -1 }
      : { ephemeral: true }),
  });

  try {
    const root = (await box.getUserRootDir()) ?? "";
    const repoDir = joinPath(root, WORKSPACE_SUBDIR);

    if (opts?.gitToken) await setupGitAuth(box, opts.gitToken);

    if (opts?.repoUrl) {
      await box.git.clone(
        opts.repoUrl,
        WORKSPACE_SUBDIR,
        opts.branch,
        undefined,
        opts.gitToken ? "x-access-token" : undefined,
        opts.gitToken,
      );
    } else {
      // Bare workspace: still anchor everything under repo/ so the path model
      // (and a later reconnect, which assumes repo/) stays consistent.
      await box.process.executeCommand(`mkdir -p ${WORKSPACE_SUBDIR}`);
    }

    return new DaytonaWorkspace(box, repoDir);
  } catch (err) {
    try {
      await box.delete();
    } catch {
      /* best-effort */
    }
    throw err;
  }
}

/**
 * Reattach to an existing Daytona box by id (the persistent IDE workspace
 * stores the id and reconnects per request). The repo lives at the deterministic
 * `<root>/repo` path the create path established, so we recompute it rather than
 * persisting it. The box is resumed if it had been auto-stopped.
 */
async function connectDaytonaSandbox(
  daytona: Daytona,
  id: string,
): Promise<Sandbox> {
  const box = await daytona.get(id);
  const root = (await box.getUserRootDir()) ?? "";
  const repoDir = joinPath(root, WORKSPACE_SUBDIR);
  const ws = new DaytonaWorkspace(box, repoDir);
  await ws.start();
  return ws;
}

function getDaytona(): Daytona {
  const config = readDaytonaConfig();
  if (!config) {
    throw new Error(
      "Daytona is not configured. Set DAYTONA_API_KEY (and optionally " +
        "DAYTONA_API_URL) to enable the coding agent's sandbox.",
    );
  }
  return new Daytona({ apiKey: config.apiKey, apiUrl: config.apiUrl });
}

/**
 * The Daytona {@link SandboxProvider}. Reads credentials from the environment
 * on each call; throws a clear error when Daytona isn't configured.
 */
export const daytonaSandboxProvider: SandboxProvider = {
  name: "daytona",
  async create(opts) {
    return createDaytonaSandbox(getDaytona(), opts);
  },
  async connect(id) {
    return connectDaytonaSandbox(getDaytona(), id);
  },
};
