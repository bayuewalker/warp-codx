/**
 * Phase 3.5 — Pure extractor for `<!-- TASK_COMPLETE: {json} -->` markers.
 *
 * CMD emits this marker at the END of an assistant turn when a discrete
 * task has reached a terminal state (issue created, PR merged, PR
 * closed, PR held, constitution refreshed, or generic done). The
 * client renders a `TaskCompleteCard` summarising the outcome instead
 * of forcing the user to scan the prose.
 *
 * Marker shape examples:
 *   <!-- TASK_COMPLETE: {"kind":"issue_created","issue":{"number":127,"title":"…","url":"…"}} -->
 *   <!-- TASK_COMPLETE: {"kind":"pr_merged","pr":{"number":843,"branch":"WARP/foo","mergeCommit":"abc1234"}} -->
 *   <!-- TASK_COMPLETE: {"kind":"pr_closed","pr":{"number":843,"reason":"superseded by #850"}} -->
 *   <!-- TASK_COMPLETE: {"kind":"pr_held","pr":{"number":843,"reason":"awaiting SENTINEL pairing"}} -->
 *   <!-- TASK_COMPLETE: {"kind":"constitution_refreshed","refresh":{"filesUpdated":3,"lastSyncIso":"2026-05-01T11:00:00Z"}} -->
 *   <!-- TASK_COMPLETE: {"kind":"generic","summary":"…"} -->
 *
 * Two-pass design (mirrors `extractPRAction`):
 *   1. Permissive STRIP — remove ANY `<!-- TASK_COMPLETE: ... -->`
 *      shape, well-formed or not, so the marker never leaks into the
 *      visible prose.
 *   2. Strict PARSE — only well-formed JSON with a recognised `kind`
 *      mounts the card. Malformed markers strip silently.
 *
 * Lifted out of `MessageContent.tsx` for the same reason as
 * `extractPRAction`: pure string→object so vitest can cover every
 * branch without a JSX environment.
 */

export type TaskCompletePayload =
  | {
      kind: "issue_created";
      issue: { number: number; title: string; url: string };
    }
  | {
      kind: "pr_merged";
      pr: {
        number: number;
        branch?: string;
        mergeCommit?: string;
        url?: string;
      };
    }
  | {
      kind: "pr_closed";
      pr: { number: number; reason?: string; url?: string };
    }
  | {
      kind: "pr_held";
      pr: { number: number; reason?: string; url?: string };
    }
  | {
      kind: "constitution_refreshed";
      refresh: { filesUpdated: number; lastSyncIso?: string };
    }
  | { kind: "generic"; summary: string };

export type TaskCompleteExtract = {
  cleaned: string;
  payload: TaskCompletePayload | null;
};

const STRIP_RE = /<!--\s*TASK_COMPLETE:[\s\S]*?-->/gi;
const PARSE_RE = /<!--\s*TASK_COMPLETE:\s*([\s\S]*?)\s*-->/i;

const VALID_KINDS = new Set<TaskCompletePayload["kind"]>([
  "issue_created",
  "pr_merged",
  "pr_closed",
  "pr_held",
  "constitution_refreshed",
  "generic",
]);

export function extractTaskComplete(raw: string): TaskCompleteExtract {
  const cleaned = raw.replace(STRIP_RE, "").trim();
  if (cleaned === raw.trim()) return { cleaned: raw, payload: null };

  const match = raw.match(PARSE_RE);
  if (!match) return { cleaned, payload: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return { cleaned, payload: null };
  }

  const payload = validatePayload(parsed);
  return { cleaned, payload };
}

function validatePayload(value: unknown): TaskCompletePayload | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== "string") return null;
  if (!VALID_KINDS.has(kind as TaskCompletePayload["kind"])) return null;

  switch (kind) {
    case "issue_created": {
      const issue = obj.issue as Record<string, unknown> | undefined;
      if (!issue) return null;
      const num = toPositiveInt(issue.number);
      const title = typeof issue.title === "string" ? issue.title : null;
      const url = typeof issue.url === "string" ? issue.url : null;
      if (num === null || title === null || url === null) return null;
      return { kind, issue: { number: num, title, url } };
    }
    case "pr_merged": {
      const pr = obj.pr as Record<string, unknown> | undefined;
      if (!pr) return null;
      const num = toPositiveInt(pr.number);
      if (num === null) return null;
      return {
        kind,
        pr: {
          number: num,
          branch: typeof pr.branch === "string" ? pr.branch : undefined,
          mergeCommit:
            typeof pr.mergeCommit === "string" ? pr.mergeCommit : undefined,
          url: typeof pr.url === "string" ? pr.url : undefined,
        },
      };
    }
    case "pr_closed":
    case "pr_held": {
      const pr = obj.pr as Record<string, unknown> | undefined;
      if (!pr) return null;
      const num = toPositiveInt(pr.number);
      if (num === null) return null;
      return {
        kind,
        pr: {
          number: num,
          reason: typeof pr.reason === "string" ? pr.reason : undefined,
          url: typeof pr.url === "string" ? pr.url : undefined,
        },
      };
    }
    case "constitution_refreshed": {
      const refresh = obj.refresh as Record<string, unknown> | undefined;
      if (!refresh) return null;
      const files = toPositiveInt(refresh.filesUpdated);
      if (files === null) return null;
      return {
        kind,
        refresh: {
          filesUpdated: files,
          lastSyncIso:
            typeof refresh.lastSyncIso === "string"
              ? refresh.lastSyncIso
              : undefined,
        },
      };
    }
    case "generic": {
      const summary = typeof obj.summary === "string" ? obj.summary : null;
      if (summary === null || summary.trim() === "") return null;
      return { kind, summary };
    }
    default:
      return null;
  }
}

function toPositiveInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}
