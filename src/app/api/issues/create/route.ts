/**
 * Phase 3b — POST /api/issues/create
 *
 * Creates a new GitHub issue on `bayuewalker/walkermind-os` from a
 * client-side IssueCard, then writes an audit row into
 * `public.issues_created`.
 *
 * Request body:
 *   {
 *     sessionId: string,             // optional — null is allowed
 *     title: string,                 // ≤256 chars after trim
 *     body: string,                  // full FORGE TASK markdown
 *     branchSlug: string,            // kebab-case slug
 *     validationTier: "MINOR"|"STANDARD"|"MAJOR",
 *     labels?: string[]              // ["forge-task"] auto-prepended
 *   }
 *
 * Response (200):
 *   { issueNumber: number, issueUrl: string, title: string }
 *
 * Failure modes:
 *   400 — invalid body
 *   500 — GitHub create or Supabase insert failed (sanitized message)
 *
 * The GitHub PAT (`GITHUB_PAT_CONSTITUTION`) is never logged or
 * returned in any branch. The Supabase audit row failure is reported
 * back to the client but does NOT undo the GitHub create — the issue
 * exists; the audit log is best-effort.
 */
import { NextResponse } from "next/server";
import { createIssue } from "@/lib/github-issues";
import { getServerSupabase } from "@/lib/supabase";
import { isAdminAllowed } from "@/lib/adminGate";
import { sendPushToAll } from "@/lib/push-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIER_VALUES = ["MINOR", "STANDARD", "MAJOR"] as const;
type Tier = (typeof TIER_VALUES)[number];

/**
 * Phase 3b — branch slug validation.
 *
 * Empty / missing is allowed (audit row will store null). When provided,
 * must be a kebab-case slug: lowercase ASCII letters and digits, segments
 * separated by single hyphens, 1-80 chars, no leading/trailing/double
 * hyphens. Tight on purpose — the value is later concatenated as
 * `WARP/<slug>` into a real GitHub branch name, so we reject anything
 * a Git ref-name would.
 */
const BRANCH_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function isValidBranchSlug(s: string): boolean {
  if (s.length === 0) return true;
  if (s.length > 80) return false;
  return BRANCH_SLUG_RE.test(s);
}

type CreateBody = {
  sessionId?: string | null;
  title?: string;
  body?: string;
  branchSlug?: string;
  validationTier?: string;
  labels?: string[];
};

function isTier(v: unknown): v is Tier {
  return typeof v === "string" && (TIER_VALUES as readonly string[]).includes(v);
}

export async function POST(req: Request) {
  // Phase 3b — admin gate. The PAT-backed write surface must not be
  // callable by anonymous traffic on a public deploy. In dev / preview
  // the gate is a no-op, identical to /api/constitution/clear.
  if (!isAdminAllowed(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let parsed: CreateBody;
  try {
    parsed = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const title = (parsed.title ?? "").trim();
  const body = (parsed.body ?? "").trim();
  const branchSlug = (parsed.branchSlug ?? "").trim();
  const validationTier = parsed.validationTier;
  const sessionId =
    typeof parsed.sessionId === "string" && parsed.sessionId.length > 0
      ? parsed.sessionId
      : null;

  if (title.length === 0 || title.length > 256) {
    return NextResponse.json(
      { error: "title is required and must be ≤256 chars" },
      { status: 400 },
    );
  }
  if (body.length === 0) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }
  if (!isTier(validationTier)) {
    return NextResponse.json(
      { error: "validationTier must be MINOR | STANDARD | MAJOR" },
      { status: 400 },
    );
  }
  if (!isValidBranchSlug(branchSlug)) {
    return NextResponse.json(
      {
        error:
          "branchSlug must be kebab-case (lowercase a-z, 0-9, single hyphens), 1-80 chars",
      },
      { status: 400 },
    );
  }

  // Compose labels — always include `forge-task`, plus a tier label
  // when STANDARD/MAJOR (per spec). MINOR gets only `forge-task`.
  const incoming = Array.isArray(parsed.labels) ? parsed.labels : [];
  const labelSet = new Set<string>(["forge-task", ...incoming]);
  if (validationTier === "STANDARD") labelSet.add("standard");
  if (validationTier === "MAJOR") labelSet.add("major");
  const labels = Array.from(labelSet);

  let created;
  try {
    created = await createIssue({ title, body, labels });
  } catch (err) {
    const message = err instanceof Error ? err.message : "github create failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Audit insert — best-effort. Never roll back the GitHub create.
  try {
    const supabase = getServerSupabase();
    const { error: insertErr } = await supabase
      .from("issues_created")
      .insert({
        session_id: sessionId,
        github_issue_number: created.number,
        github_issue_url: created.url,
        title: created.title,
        branch_slug: branchSlug || null,
        validation_tier: validationTier,
      });
    if (insertErr) {
      console.error(
        `[issues/create] audit insert failed (issue #${created.number} created on GitHub but not logged): ${insertErr.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[issues/create] audit insert threw (issue #${created.number} created on GitHub but not logged): ${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
  }

  // Phase 4 — fire-and-forget push notification. Detached (`void`)
  // so the response is never blocked on Supabase select + push fanout.
  // `sendPushToAll` swallows every error internally; the `.catch` here
  // is a defensive guard against any future regression.
  void sendPushToAll({
    title: "🔖 Issue created",
    body: `#${created.number} — ${created.title.slice(0, 60)}`,
    tag: `issue-${created.number}`,
    url: created.url,
  }).catch((err) =>
    console.error(
      `[push] issue dispatch escaped: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    ),
  );

  return NextResponse.json({
    issueNumber: created.number,
    issueUrl: created.url,
    title: created.title,
  });
}
