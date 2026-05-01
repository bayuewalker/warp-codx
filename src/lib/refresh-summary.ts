/**
 * Shared client-side summarizer for the response body of
 * `POST /api/constitution/refresh`. The endpoint returns three
 * distinct shapes the UI must distinguish so operators never see a
 * silent partial failure:
 *
 *   1. Hard auth/server error (HTTP 401 / 503 / 5xx)
 *      → body `{ ok:false, error: "<message>" }`
 *   2. Partial degradation (HTTP 200, ok:false)
 *      → body `{ ok:false, refreshed, failed, files:[ {path, status, error?, warning?}, ... ] }`
 *   3. Full success (HTTP 200, ok:true)
 *      → body `{ ok:true, refreshed, failed:0, files:[...] }`
 *
 * `summarizeRefresh` returns a discriminated result that callers use
 * for both the "ok / fail" branching AND the human-readable label so
 * every refresh entry point (status sheet, settings drawer, slash
 * command) renders the same wording.
 */

export type RefreshFile = {
  path: string;
  status?: string;
  error?: string;
  warning?: string;
  sizeBytes?: number;
  fetchedAt?: string;
};

export type RefreshBody = {
  ok?: boolean;
  error?: string;
  refreshed?: number;
  failed?: number;
  files?: RefreshFile[];
};

export type RefreshSummary = {
  /** True only on a clean full-success refresh. */
  ok: boolean;
  /** Operator-readable single-line summary (empty string never returned). */
  message: string;
  /** Number of files freshly pulled from GitHub. */
  refreshed: number;
  /** Number of files that fell back to stale cache or are unavailable. */
  failed: number;
};

export function summarizeRefresh(
  res: Response,
  body: RefreshBody | null,
): RefreshSummary {
  const refreshed = body?.refreshed ?? 0;
  const failed = body?.failed ?? 0;
  const ok = res.ok && body?.ok !== false;

  if (ok) {
    return {
      ok: true,
      message: `Constitution refreshed — ${refreshed} files updated${
        failed > 0 ? `, ${failed} cached` : ""
      }.`,
      refreshed,
      failed,
    };
  }

  // Failure path. Prefer the server's top-level error (auth/server);
  // otherwise derive a per-file summary from `files[]` so partial
  // failures are never silent.
  if (body?.error) {
    return { ok: false, message: body.error, refreshed, failed };
  }

  if (body?.files && body.files.length > 0) {
    const degraded = body.files
      .filter((f) => f.error || f.warning || f.status === "error_fallback")
      .map((f) => `${f.path}: ${f.error ?? f.warning ?? "fallback"}`);
    if (degraded.length > 0) {
      return {
        ok: false,
        message: `${refreshed} refreshed, ${
          failed || degraded.length
        } degraded — ${degraded.join("; ")}`,
        refreshed,
        failed: failed || degraded.length,
      };
    }
  }

  return {
    ok: false,
    message: `Refresh reported ok:false (HTTP ${res.status})`,
    refreshed,
    failed,
  };
}
