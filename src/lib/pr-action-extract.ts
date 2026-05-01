/**
 * Phase 3c — Pure extractor for `<!-- PR_ACTION: ... -->` markers.
 *
 * CMD emits exactly one of the following at the end of an assistant
 * message when the user's intent is PR-related (per `pr-action-protocol.ts`):
 *
 *   <!-- PR_ACTION: list -->
 *   <!-- PR_ACTION: detail:N -->
 *   <!-- PR_ACTION: merge:N -->
 *   <!-- PR_ACTION: close:N -->
 *   <!-- PR_ACTION: hold:N -->     (Phase 3c gate hardening — manual HOLD)
 *
 * `MessageContent.tsx` calls this to split the rendered prose from the
 * marker, so the marker never leaks into the chat bubble. Lifted out
 * of the component file so it stays a pure string→object function with
 * no React/CSS imports — that makes it trivially unit-testable from
 * `src/lib/pr-gates.test.ts` (Task #26) without standing up a JSX
 * test environment.
 *
 * Two-pass design (per code review):
 *   1. Permissive STRIP: remove ANY `<!-- PR_ACTION: ... -->` shape,
 *      even malformed ones like `merge:abc` or `bogus`. Guarantees
 *      fail-quiet stripping so protocol artifacts never leak into
 *      rendered prose.
 *   2. Strict PARSE: only the well-formed shapes (`list` /
 *      `<kind>:<int>`) produce an action that mounts a card. Malformed
 *      markers strip but mount nothing — same policy as
 *      `extractIssueDraft`.
 *
 * Note: regex literals with /g share `lastIndex` state across calls
 * when .test() / .exec() is invoked, which can cause "stuck" iterator
 * bugs. We only call .matchAll() (fresh iterator each call) and
 * .replace() (independent global scan), so reuse is safe.
 */

export type PRAction =
  | { kind: "list" }
  | { kind: "detail" | "merge" | "close" | "hold"; prNumber: number };

export type PRActionExtract = {
  cleaned: string;
  action: PRAction | null;
};

const STRIP_RE = /<!--\s*PR_ACTION:[^>]*?-->/gi;
const PARSE_RE =
  /<!--\s*PR_ACTION:\s*([a-z]+)(?:\s*:\s*(\d+))?\s*-->/gi;

export function extractPRAction(raw: string): PRActionExtract {
  const cleaned = raw.replace(STRIP_RE, "").trim();
  if (cleaned === raw.trim()) return { cleaned: raw, action: null };

  let action: PRAction | null = null;
  for (const m of raw.matchAll(PARSE_RE)) {
    if (action) break;
    const kind = m[1].toLowerCase();
    const numStr = m[2];
    if (kind === "list") {
      action = { kind: "list" };
      continue;
    }
    if (
      kind === "detail" ||
      kind === "merge" ||
      kind === "close" ||
      kind === "hold"
    ) {
      const n = numStr ? Number.parseInt(numStr, 10) : NaN;
      if (Number.isInteger(n) && n > 0) {
        action = { kind, prNumber: n };
      }
      // Else: malformed — keep scanning in case a later marker is good.
    }
  }

  return { cleaned, action };
}
