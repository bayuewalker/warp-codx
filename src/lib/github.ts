/**
 * Thin Octokit wrapper for the WalkerMind constitution repo.
 *
 * Authenticates from the server-only env var GITHUB_PAT_CONSTITUTION (a
 * fine-grained PAT scoped to `contents:read` on `bayuewalker/walkermind-os`).
 * The PAT value is NEVER logged, NEVER returned to the browser, and NEVER
 * written into the constitution_fetch_log error_message column.
 */
import { Octokit } from "@octokit/rest";

const REPO_OWNER = "bayuewalker";
const REPO_NAME = "walkermind-os";
const REQUEST_TIMEOUT_MS = 10_000;

export const CONSTITUTION_REPO = { owner: REPO_OWNER, name: REPO_NAME } as const;

let _client: Octokit | null = null;

function getClient(): Octokit {
  if (_client) return _client;
  const token = process.env.GITHUB_PAT_CONSTITUTION;
  if (!token) {
    throw new Error(
      "Missing required environment variable: GITHUB_PAT_CONSTITUTION. " +
        "Create a fine-grained PAT with `contents:read` on " +
        "bayuewalker/walkermind-os and set it in your environment.",
    );
  }
  _client = new Octokit({
    auth: token,
    request: {
      // 10s hard timeout per the spec.
      // node 18+ exposes AbortSignal.timeout natively.
      // Octokit forwards `signal` through to fetch.
      // We re-create the signal per-call below; this default is just a
      // belt-and-braces guard.
      timeout: REQUEST_TIMEOUT_MS,
    },
  });
  return _client;
}

export type RawConstitutionFile = {
  content: string;
  sha: string;
  sizeBytes: number;
};

/**
 * Fetch one file's content + SHA from the constitution repo at HEAD of the
 * default branch. Returns decoded UTF-8 text.
 *
 * Errors are re-thrown with sanitized messages — the original Octokit error
 * (which can carry response headers including the auth header) is dropped on
 * the floor so it can never leak into a log row or HTTP response.
 */
export async function fetchRepoFile(
  path: string,
): Promise<RawConstitutionFile> {
  const octokit = getClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await octokit.rest.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path,
      request: { signal: controller.signal },
    });
    const data = res.data;
    if (Array.isArray(data) || data.type !== "file") {
      throw new Error(`Path ${path} is not a file`);
    }
    if (!("content" in data) || typeof data.content !== "string") {
      throw new Error(`Path ${path} has no inline content`);
    }
    // GitHub returns base64 with embedded newlines.
    const text = Buffer.from(data.content, "base64").toString("utf8");
    return {
      content: text,
      sha: data.sha,
      sizeBytes: Buffer.byteLength(text, "utf8"),
    };
  } catch (err) {
    // Sanitize: never re-throw the raw Octokit error (which carries headers).
    const status =
      typeof (err as { status?: number }).status === "number"
        ? (err as { status?: number }).status
        : undefined;
    const message =
      err instanceof Error ? err.name + ": " + err.message : "github_error";
    const safe = status ? `github_${status}: ${message}` : message;
    throw new Error(safe);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lightweight reachability + auth check for the PAT.
 * Returns "ok" / "unauthorized" / "other:<status>".
 */
export async function pingRepo(): Promise<{
  status: "ok" | "unauthorized" | "other";
  detail: string;
}> {
  try {
    const octokit = getClient();
    const res = await octokit.rest.repos.get({
      owner: REPO_OWNER,
      repo: REPO_NAME,
    });
    return { status: "ok", detail: `${res.data.full_name}` };
  } catch (err) {
    const status =
      typeof (err as { status?: number }).status === "number"
        ? (err as { status?: number }).status!
        : 0;
    if (status === 401 || status === 403) {
      return { status: "unauthorized", detail: `http_${status}` };
    }
    return { status: "other", detail: `http_${status || "network"}` };
  }
}
