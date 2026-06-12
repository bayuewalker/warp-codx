/**
 * Persistent IDE workspace service.
 *
 * The Replit-style IDE needs a *durable, reconnectable* sandbox per user, in
 * contrast to the coding agent's create→loop→destroy ephemeral box. This module
 * is the bridge between the {@link SandboxProvider} (which knows how to spin up
 * and reattach to a box) and the {@link WorkspaceRecord} store (which pins the
 * user→sandbox id mapping). Every collaborator is injectable so the routes and
 * tests never depend on Daytona being configured.
 *
 * Lifecycle:
 *   ensureWorkspace  → create a persistent box (or resume the stored one)
 *   connectSandbox   → reattach to the stored box for a single file/exec op
 *   stopWorkspace    → stop the box but keep its filesystem (resumable)
 *   destroyWorkspace → delete the box and forget the mapping
 */
import { daytonaSandboxProvider } from "./sandbox-daytona";
import type { Sandbox, SandboxProvider } from "./sandbox";
import {
  deleteWorkspaceRecord,
  getWorkspaceRecord,
  upsertWorkspaceRecord,
  type WorkspaceRecord,
} from "./workspace-store";

export type WorkspaceDeps = {
  /** Sandbox backend (default: Daytona). */
  provider?: SandboxProvider;
  /** Git token injected for clone + push (default: server-side PAT envs). */
  gitToken?: string;
};

export type EnsureWorkspaceInput = {
  userId: string;
  /** HTTPS repo URL to clone on first creation (ignored when one already exists). */
  repoUrl?: string;
  /** Branch to check out on first creation. */
  branch?: string;
};

/** Default git token: reuse the constitution PAT, then generic GitHub envs. */
function defaultGitToken(): string | undefined {
  return (
    process.env.GITHUB_PAT_CONSTITUTION?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GITHUB_PAT?.trim() ||
    undefined
  );
}

function resolveProvider(deps: WorkspaceDeps): SandboxProvider {
  return deps.provider ?? daytonaSandboxProvider;
}

/**
 * Ensure the user has a live, persistent workspace and return its record plus a
 * connected {@link Sandbox}. Creates a new box on first use (cloning the repo if
 * given); otherwise reconnects to the stored box and resumes it if it had been
 * auto-stopped. The record is stamped `running` on success, `error` on failure.
 */
export async function ensureWorkspace(
  input: EnsureWorkspaceInput,
  deps: WorkspaceDeps = {},
): Promise<{ record: WorkspaceRecord | null; sandbox: Sandbox }> {
  const provider = resolveProvider(deps);
  const gitToken = deps.gitToken ?? defaultGitToken();
  const existing = await getWorkspaceRecord(input.userId);

  // Reconnect path — a box id is already pinned to this user.
  if (existing?.sandbox_id && provider.connect) {
    try {
      const sandbox = await provider.connect(existing.sandbox_id);
      const record = await upsertWorkspaceRecord(input.userId, {
        status: "running",
        touchActivity: true,
      });
      return { record: record ?? existing, sandbox };
    } catch {
      // The stored box is gone (deleted/expired). Fall through and create a
      // fresh one, overwriting the stale mapping below.
    }
  }

  // Create path — mark `creating` first so a concurrent poll sees progress.
  await upsertWorkspaceRecord(input.userId, {
    status: "creating",
    repo_url: input.repoUrl ?? null,
    branch: input.branch ?? null,
  });

  try {
    const sandbox = await provider.create({
      repoUrl: input.repoUrl,
      branch: input.branch,
      gitToken,
      persistent: true,
    });
    const record = await upsertWorkspaceRecord(input.userId, {
      sandbox_id: sandbox.id,
      repo_url: input.repoUrl ?? null,
      branch: input.branch ?? null,
      status: "running",
      preview_url: null,
      preview_port: null,
      touchActivity: true,
    });
    return { record, sandbox };
  } catch (err) {
    await upsertWorkspaceRecord(input.userId, { status: "error" });
    throw err;
  }
}

/**
 * Reattach to the user's stored workspace box for a single operation (read /
 * write / list / exec). Throws a clear error when there's no workspace yet or
 * the backend can't reconnect, so routes can map it to a 409/501.
 */
export async function connectSandbox(
  userId: string,
  deps: WorkspaceDeps = {},
): Promise<Sandbox> {
  const provider = resolveProvider(deps);
  const record = await getWorkspaceRecord(userId);
  if (!record?.sandbox_id) {
    throw new WorkspaceNotReadyError("No workspace — start one first.");
  }
  if (!provider.connect) {
    throw new WorkspaceNotReadyError(
      "The sandbox backend does not support persistent workspaces.",
    );
  }
  const sandbox = await provider.connect(record.sandbox_id);
  // Touch activity so an idle reaper (and the UI's "last active") stays honest.
  void upsertWorkspaceRecord(userId, { status: "running", touchActivity: true });
  return sandbox;
}

/** Stop the box (keep its filesystem). The next ensure/connect resumes it. */
export async function stopWorkspace(
  userId: string,
  deps: WorkspaceDeps = {},
): Promise<void> {
  const provider = resolveProvider(deps);
  const record = await getWorkspaceRecord(userId);
  if (!record?.sandbox_id || !provider.connect) {
    await upsertWorkspaceRecord(userId, { status: "stopped" });
    return;
  }
  try {
    const sandbox = await provider.connect(record.sandbox_id);
    if (sandbox.stop) await sandbox.stop();
  } catch {
    /* box already gone — fall through to mark stopped */
  }
  await upsertWorkspaceRecord(userId, { status: "stopped" });
}

/** Delete the box and forget the mapping (a hard reset of the workspace). */
export async function destroyWorkspace(
  userId: string,
  deps: WorkspaceDeps = {},
): Promise<void> {
  const provider = resolveProvider(deps);
  const record = await getWorkspaceRecord(userId);
  if (record?.sandbox_id && provider.connect) {
    try {
      const sandbox = await provider.connect(record.sandbox_id);
      await sandbox.destroy();
    } catch {
      /* best-effort — the box may already be gone */
    }
  }
  await deleteWorkspaceRecord(userId);
}

/** Error thrown when a workspace op is attempted before one is ready. */
export class WorkspaceNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceNotReadyError";
  }
}
