/**
 * Task #35 — Sanitized-adapter-error → HTTP status mapping.
 *
 * The `src/lib/github-prs.ts` adapter normalizes every Octokit failure
 * to the contract:
 *
 *     `github_<op>_<status>: <name>: <raw>`
 *
 * (e.g. `github_detail_404: HttpError: Not Found`,
 *  `github_merge_403: PAT missing pull_requests:write — re-grant in repo settings`).
 *
 * The route layer is responsible for translating that sanitized
 * message back into the matching HTTP status the operator-facing
 * client expects. Without this helper, every adapter 4xx silently
 * downgrades to 500 — the operator sees "internal server error" when
 * the truth is "PR not found" / "Bad credentials" / "PAT missing
 * scope". A regression in this layer is exactly what Task #35 is
 * meant to catch (see route .test.ts files).
 *
 * Pass-through statuses cover every code the adapter actually emits:
 *   - 401 — Bad credentials (any op)
 *   - 403 — PAT missing scope on merge (sanitize special-cases this)
 *   - 404 — PR / repo not found (any op)
 *   - 405 — PR not mergeable on merge (sanitize special-cases this)
 *   - 422 — GitHub validation error (any op)
 *
 * Anything else collapses to 500 — including unrecognized status
 * codes, legacy fall-throughs (`github_<op>_x:`), and non-Error
 * throws (which the routes pre-stringify to "github X failed").
 */

const STATUS_RE = /^github_\w+_(\d+)\b/;
const PASSTHROUGH_STATUSES = new Set([401, 403, 404, 405, 422]);

/**
 * Translate a sanitized adapter error message to the matching HTTP
 * status. Returns 500 when no `github_<op>_<status>:` prefix is found
 * or the status isn't in the pass-through set.
 *
 * Safe to call with any string — never throws.
 */
export function statusFromAdapterError(message: string): number {
  const m = message.match(STATUS_RE);
  if (!m) return 500;
  const code = Number.parseInt(m[1], 10);
  if (!Number.isFinite(code)) return 500;
  return PASSTHROUGH_STATUSES.has(code) ? code : 500;
}
