/**
 * Phase 3b — Octokit wrapper for GitHub Issues operations on the
 * `bayuewalker/walkermind-os` repo.
 *
 * Kept deliberately separate from `src/lib/github.ts` (the Phase 3a
 * constitution-fetch wrapper) per the hard constraint:
 *   "DO NOT touch Phase 3a constitution fetch logic"
 *
 * Both modules share the same PAT (`GITHUB_PAT_CONSTITUTION`, expanded
 * in Phase 3b to include `Issues: Read and write`) but instantiate
 * separate lazy Octokit clients. The cost is one additional
 * HTTP keep-alive pool — negligible for the expected traffic.
 *
 * SECURITY:
 *   - The PAT is read once at first use and never logged, returned, or
 *     persisted. Octokit-thrown errors carry the auth header in
 *     `error.response.headers`; we always re-throw a sanitized
 *     `github_<status>: <name: message>` string instead of the raw
 *     error.
 */
import { Octokit } from "@octokit/rest";

const REPO_OWNER = "bayuewalker";
const REPO_NAME = "walkermind-os";

export const ISSUES_REPO = { owner: REPO_OWNER, name: REPO_NAME } as const;

let _client: Octokit | null = null;

function getClient(): Octokit {
  if (_client) return _client;
  const token = process.env.GITHUB_PAT_CONSTITUTION;
  if (!token) {
    throw new Error(
      "github-issues: GITHUB_PAT_CONSTITUTION env var is not set",
    );
  }
  _client = new Octokit({
    auth: token,
    request: {
      // 8s — issue create/list should never be slow; fail fast.
      timeout: 8_000,
    },
  });
  return _client;
}

export type CreateIssueInput = {
  title: string;
  body: string;
  labels?: string[];
};

export type CreatedIssue = {
  number: number;
  url: string;
  title: string;
};

/**
 * Create a new issue on `bayuewalker/walkermind-os`.
 *
 * Throws a sanitized `github_<status>` error string on failure — the
 * raw Octokit error (which can echo the PAT via response headers) is
 * never re-thrown.
 */
export async function createIssue(
  input: CreateIssueInput,
): Promise<CreatedIssue> {
  const octokit = getClient();
  try {
    const res = await octokit.rest.issues.create({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      title: input.title,
      body: input.body,
      labels: input.labels ?? [],
    });
    return {
      number: res.data.number,
      url: res.data.html_url,
      title: res.data.title,
    };
  } catch (err: unknown) {
    throw sanitize(err, "create");
  }
}

export type ListedIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  labels: string[];
  createdAt: string;
};

/**
 * List issues on `bayuewalker/walkermind-os` filtered by the
 * `forge-task` label. Returns the most recent 50 (open + closed)
 * sorted by creation time, newest first.
 */
export async function listForgeIssues(): Promise<ListedIssue[]> {
  const octokit = getClient();
  try {
    const res = await octokit.rest.issues.listForRepo({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      labels: "forge-task",
      state: "all",
      sort: "created",
      direction: "desc",
      per_page: 50,
    });
    return res.data
      // Filter out PRs — the issues endpoint includes them and we don't want them here.
      .filter((it) => !("pull_request" in it) || !it.pull_request)
      .map((it) => ({
        number: it.number,
        title: it.title,
        state: (it.state === "closed" ? "closed" : "open") as "open" | "closed",
        url: it.html_url,
        labels: (it.labels ?? [])
          .map((l) => (typeof l === "string" ? l : l.name))
          .filter((n): n is string => typeof n === "string" && n.length > 0),
        createdAt: it.created_at,
      }));
  } catch (err: unknown) {
    throw sanitize(err, "list");
  }
}

/**
 * Convert any Octokit / network error into a sanitized Error whose
 * `.message` is safe to surface to the client. The original error is
 * NEVER re-thrown — Octokit attaches request headers (including the
 * Authorization header) to thrown errors.
 */
function sanitize(err: unknown, op: "create" | "list"): Error {
  // Octokit RequestError shape: { status, name, message, response? }
  const e = err as {
    status?: number;
    name?: string;
    message?: string;
  } | null;
  const status = e?.status ?? 0;
  const name = e?.name ?? "Error";
  // Truncate any user/server-supplied message — never include headers.
  const raw = (e?.message ?? "unknown").slice(0, 300);
  return new Error(`github_${op}_${status || "x"}: ${name}: ${raw}`);
}
