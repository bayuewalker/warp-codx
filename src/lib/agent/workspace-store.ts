/**
 * Persistent IDE workspace records (server-only).
 *
 * One row per user in `public.workspaces` pins a user to a durable Daytona box
 * (the `sandbox_id`) so the IDE reconnects to the same filesystem across
 * requests and sessions. Writes use the service-role client; the browser reads
 * its own row via RLS (migration 0009). Mirrors `agent-runs.ts`: reads degrade
 * to null and writes are best-effort so a DB hiccup never crashes an in-flight
 * file operation.
 */
import { getServerSupabase } from "../supabase";

/** Lifecycle of the workspace as the IDE understands it. */
export type WorkspaceStatus = "creating" | "running" | "stopped" | "error";

export type WorkspaceRecord = {
  id: string;
  user_id: string;
  sandbox_id: string | null;
  repo_url: string | null;
  branch: string | null;
  status: WorkspaceStatus;
  /** Port the preview/dev-server was last started on (for the webview). */
  preview_port: number | null;
  /** Last-resolved public preview URL (re-derivable, cached for the UI). */
  preview_url: string | null;
  created_at: string;
  updated_at: string;
  last_active_at: string | null;
};

const SELECT =
  "id, user_id, sandbox_id, repo_url, branch, status, preview_port, " +
  "preview_url, created_at, updated_at, last_active_at";

/** Fetch the caller's single workspace row, or null when none exists. */
export async function getWorkspaceRecord(
  userId: string,
): Promise<WorkspaceRecord | null> {
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("workspaces")
      .select(SELECT)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as WorkspaceRecord;
  } catch {
    return null;
  }
}

/**
 * Upsert the caller's workspace row (one per user; `user_id` is unique). Used to
 * pin the sandbox id on create and to stamp status/preview transitions. Returns
 * the stored row, or null on failure (the caller decides whether that's fatal).
 */
export async function upsertWorkspaceRecord(
  userId: string,
  patch: Partial<{
    sandbox_id: string | null;
    repo_url: string | null;
    branch: string | null;
    status: WorkspaceStatus;
    preview_port: number | null;
    preview_url: string | null;
    touchActivity: boolean;
  }>,
): Promise<WorkspaceRecord | null> {
  try {
    const supabase = getServerSupabase();
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      user_id: userId,
      updated_at: now,
    };
    if (patch.sandbox_id !== undefined) row.sandbox_id = patch.sandbox_id;
    if (patch.repo_url !== undefined) row.repo_url = patch.repo_url;
    if (patch.branch !== undefined) row.branch = patch.branch;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.preview_port !== undefined) row.preview_port = patch.preview_port;
    if (patch.preview_url !== undefined) row.preview_url = patch.preview_url;
    if (patch.touchActivity) row.last_active_at = now;

    const { data, error } = await supabase
      .from("workspaces")
      .upsert(row, { onConflict: "user_id" })
      .select(SELECT)
      .single();
    if (error || !data) return null;
    return data as unknown as WorkspaceRecord;
  } catch {
    return null;
  }
}

/** Delete the caller's workspace row (after the box is destroyed). Best-effort. */
export async function deleteWorkspaceRecord(userId: string): Promise<void> {
  try {
    const supabase = getServerSupabase();
    await supabase.from("workspaces").delete().eq("user_id", userId);
  } catch {
    /* best-effort */
  }
}
