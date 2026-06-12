/**
 * Workspace path safety.
 *
 * Every IDE file operation (read / write / list) takes a client-supplied path
 * and resolves it against the workspace root *inside the sandbox*. A path like
 * `../../etc/passwd` or `/etc/shadow` must never escape the workspace, so this
 * pure helper normalizes and validates the input before it ever reaches the
 * backend. Kept dependency-free and pure so it's exhaustively unit-testable and
 * shared by every route.
 */

/**
 * Normalize a client path to a safe, workspace-relative POSIX path, or return
 * `null` when it tries to escape (absolute, `..` traversal, NUL byte). The
 * result never starts with `/` or `.`; `""` means the workspace root.
 */
export function safeWorkspacePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  // Reject NUL bytes outright — they can truncate paths in C-backed APIs.
  if (input.includes("\0")) return null;

  // Normalize separators and collapse redundant slashes.
  const raw = input.replace(/\\/g, "/").trim();

  // Absolute paths are not workspace-relative.
  if (raw.startsWith("/")) return null;

  const parts: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue; // skip empties and `.`
    if (seg === "..") return null; // any traversal escapes — reject the whole path
    parts.push(seg);
  }
  return parts.join("/");
}

/** Convenience: the root is the empty path. */
export const WORKSPACE_ROOT = "";
