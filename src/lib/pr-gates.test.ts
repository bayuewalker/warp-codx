/**
 * Task #26 — `evaluateMergeGates` + `extractPRAction` unit tests.
 *
 * Pure-function tests, no mocks. Two surfaces under test:
 *
 *  1. `evaluateMergeGates(pr, reviews, opts)` — single source of truth
 *     for the pre-merge gate decision shared by the PRCard checklist
 *     UI and the server-side merge route. Both code paths must agree,
 *     so this test covers every blocker shape.
 *
 *  2. `extractPRAction(raw)` — the marker stripper relocated to
 *     `src/lib/pr-action-extract.ts` precisely so we can unit-test it
 *     here without spinning up a JSX test environment for
 *     `MessageContent.tsx`.
 *
 * On the `mergeable: false` scenario (#26 spec test #8): GitHub's
 * `pulls.get` exposes a `mergeable: boolean | null` field, surfaced
 * through `src/lib/github-prs.ts` (see `mergeable` on the normalised
 * shape). It is INTENTIONALLY not a gate inside `evaluateMergeGates`
 * because the gate evaluator stays pure and the GhPR shape has no
 * `mergeable` field. The merge route does not perform an explicit
 * pre-check today — instead it lets GitHub's actual merge call return
 * 405 and translates that into `github_merge_405: PR not mergeable
 * (already merged, conflict, or branch protection)` (see
 * `src/lib/github-prs.ts` ~line 496). Either way, mergeability is a
 * route-layer concern, never a gate inside this evaluator. We
 * document that boundary by asserting an otherwise-clean PR returns
 * `ok: true` regardless of any imagined conflict state.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateMergeGates,
  isSentinelPR,
  type GhPR,
  type GhReview,
} from "./pr-gates";
import { extractPRAction } from "./pr-action-extract";

/**
 * Build a fully-populated, gate-passing PR body. Tests that want to
 * exercise a SINGLE missing field can `.replace(/^Validation Tier:.*$/m, '')`
 * etc., keeping the rest of the body untouched.
 */
function cleanBody(): string {
  return [
    "Validation Tier: STANDARD",
    "Claim Level: feature",
    "Validation Target: chat-route",
    "Not in Scope: deployment",
    "Report: green",
    "State: ready",
  ].join("\n");
}

function makePR(overrides: Partial<GhPR> = {}): GhPR {
  return {
    number: 42,
    title: "WARP/feat: clean PR",
    body: cleanBody(),
    head: { ref: "WARP/feat-clean" },
    ...overrides,
  };
}

// ──────────────────────── evaluateMergeGates ────────────────────────

describe("evaluateMergeGates", () => {
  it("#1 — clean STANDARD PR with no SENTINEL signature returns ok=true", () => {
    const result = evaluateMergeGates(makePR(), []);

    expect(result.ok).toBe(true);
    expect(result.tier).toBe("STANDARD");
    expect(result.isSentinel).toBe(false);
    expect(result.blockers).toEqual([]);
    expect(result.gates).toMatchObject({
      tierDeclared: true,
      claimDeclared: true,
      targetDeclared: true,
      notInScopeDeclared: true,
      branchFormat: true,
      sentinelApproved: true,
      forgeOutputComplete: true,
      forgeMerged: true,
    });
  });

  it("#2 — missing Validation Tier blocks merge", () => {
    const body = cleanBody().replace(/^Validation Tier:.*$/m, "");
    const result = evaluateMergeGates(makePR({ body }), []);

    expect(result.ok).toBe(false);
    expect(result.tier).toBe(null);
    expect(result.gates.tierDeclared).toBe(false);
    expect(result.blockers).toContain(
      "Validation Tier missing from PR body",
    );
  });

  it("#3 — missing Claim Level blocks merge", () => {
    const body = cleanBody().replace(/^Claim Level:.*$/m, "");
    const result = evaluateMergeGates(makePR({ body }), []);

    expect(result.ok).toBe(false);
    expect(result.gates.claimDeclared).toBe(false);
    expect(result.blockers).toContain("Claim Level missing from PR body");
  });

  it("#3b — missing Validation Target blocks merge", () => {
    const body = cleanBody().replace(/^Validation Target:.*$/m, "");
    const result = evaluateMergeGates(makePR({ body }), []);

    expect(result.ok).toBe(false);
    expect(result.gates.targetDeclared).toBe(false);
    expect(result.blockers).toContain(
      "Validation Target missing from PR body",
    );
  });

  it("#3c — missing Not in Scope blocks merge", () => {
    const body = cleanBody().replace(/^Not in Scope:.*$/m, "");
    const result = evaluateMergeGates(makePR({ body }), []);

    expect(result.ok).toBe(false);
    expect(result.gates.notInScopeDeclared).toBe(false);
    expect(result.blockers).toContain("Not in Scope missing from PR body");
  });

  it("#4 — branch ref outside WARP/* is blocked with the offending ref echoed", () => {
    const result = evaluateMergeGates(
      makePR({ head: { ref: "feature/foo" } }),
      [],
    );

    expect(result.ok).toBe(false);
    expect(result.gates.branchFormat).toBe(false);
    expect(result.blockers).toContain(
      'Branch must start with "WARP/" (got "feature/foo")',
    );
  });

  it("#4b — WARP/ prefix with a `..` traversal is rejected", () => {
    const result = evaluateMergeGates(
      makePR({ head: { ref: "WARP/foo/../bar" } }),
      [],
    );
    expect(result.gates.branchFormat).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("#4c — WARP/ prefix with whitespace is rejected", () => {
    const result = evaluateMergeGates(
      makePR({ head: { ref: "WARP/foo bar" } }),
      [],
    );
    expect(result.gates.branchFormat).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("#5 — MAJOR PR with no SENTINEL approval is blocked", () => {
    const body = cleanBody().replace(
      "Validation Tier: STANDARD",
      "Validation Tier: MAJOR",
    );
    const result = evaluateMergeGates(makePR({ body }), []);

    expect(result.ok).toBe(false);
    expect(result.tier).toBe("MAJOR");
    expect(result.gates.sentinelApproved).toBe(false);
    expect(result.blockers).toContain(
      "MAJOR tier — SENTINEL approval required",
    );
  });

  it("#5b — MAJOR PR with valid WARP•SENTINEL approval passes", () => {
    const body = cleanBody().replace(
      "Validation Tier: STANDARD",
      "Validation Tier: MAJOR",
    );
    const reviews: GhReview[] = [
      {
        state: "APPROVED",
        body: "WARP•SENTINEL review: APPROVED — looks good",
      },
    ];
    const result = evaluateMergeGates(makePR({ body }), reviews);

    expect(result.ok).toBe(true);
    expect(result.gates.sentinelApproved).toBe(true);
  });

  it("#5c — APPROVED review without SENTINEL signature does NOT count", () => {
    const body = cleanBody().replace(
      "Validation Tier: STANDARD",
      "Validation Tier: MAJOR",
    );
    const reviews: GhReview[] = [
      { state: "APPROVED", body: "looks good to me" }, // no signature
    ];
    const result = evaluateMergeGates(makePR({ body }), reviews);

    expect(result.gates.sentinelApproved).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("#5d — SENTINEL signature variants (•, ·, -, ., space) all match", () => {
    const variants = [
      "WARP•SENTINEL APPROVED",
      "WARP·SENTINEL APPROVED",
      "WARP-SENTINEL APPROVED",
      "WARP.SENTINEL APPROVED",
      "WARP SENTINEL APPROVED",
    ];
    const body = cleanBody().replace(
      "Validation Tier: STANDARD",
      "Validation Tier: MAJOR",
    );
    for (const v of variants) {
      const result = evaluateMergeGates(makePR({ body }), [
        { state: "APPROVED", body: v },
      ]);
      expect(result.gates.sentinelApproved, `variant ${v}`).toBe(true);
    }
  });

  it("#6 — missing Report: line blocks merge (G2 forge output)", () => {
    const body = cleanBody().replace(/^Report:.*$/m, "");
    const result = evaluateMergeGates(makePR({ body }), []);

    expect(result.ok).toBe(false);
    expect(result.gates.forgeOutputComplete).toBe(false);
    expect(result.blockers).toContain(
      "WARP•FORGE output missing Report: line",
    );
  });

  it("#6b — missing State: line blocks merge (G2 forge output)", () => {
    const body = cleanBody().replace(/^State:.*$/m, "");
    const result = evaluateMergeGates(makePR({ body }), []);

    expect(result.ok).toBe(false);
    expect(result.gates.forgeOutputComplete).toBe(false);
    expect(result.blockers).toContain(
      "WARP•FORGE output missing State: line",
    );
  });

  it("#7 — SENTINEL PR with paired FORGE not yet merged is blocked (G1)", () => {
    const result = evaluateMergeGates(
      makePR({ title: "WARP•SENTINEL: review of #41" }),
      [{ state: "APPROVED", body: "WARP•SENTINEL APPROVED" }],
      { forgePRMerged: false },
    );

    expect(result.isSentinel).toBe(true);
    expect(result.gates.forgeMerged).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      "WARP•SENTINEL — paired WARP•FORGE PR not yet merged",
    );
  });

  it("#7b — SENTINEL PR whose paired FORGE could not be resolved gets a distinct blocker", () => {
    const result = evaluateMergeGates(
      makePR({ title: "WARP•SENTINEL: review" }),
      [],
      { forgePRMerged: null },
    );

    expect(result.isSentinel).toBe(true);
    expect(result.gates.forgeMerged).toBe(false);
    expect(result.blockers).toContain(
      "WARP•SENTINEL — paired WARP•FORGE PR could not be resolved",
    );
  });

  it("#7c — SENTINEL PR with paired FORGE merged passes the G1 gate", () => {
    // SENTINEL PRs default to STANDARD tier (no SENTINEL self-review needed
    // for the sentinel-approval gate, since that gate only fires on MAJOR).
    const result = evaluateMergeGates(
      makePR({ title: "WARP•SENTINEL: review of #41" }),
      [],
      { forgePRMerged: true },
    );

    expect(result.isSentinel).toBe(true);
    expect(result.gates.forgeMerged).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("#8 — `mergeable: false` is route-layer concern, NOT inside evaluateMergeGates", () => {
    // Documenting the boundary: the GhPR shape has no `mergeable` field
    // by design. Today the merge route does NOT perform an explicit
    // `mergeable` pre-check — it lets GitHub's actual merge call fail
    // with 405 and translates that to `github_merge_405` (see
    // `src/lib/github-prs.ts` ~line 496). For a clean PR,
    // evaluateMergeGates therefore returns ok=true regardless of any
    // imagined merge-conflict state; the route owns surfacing the
    // conflict via the 405 translation.
    const result = evaluateMergeGates(makePR(), []);
    expect(result.ok).toBe(true);
    // Sanity: nothing in `gates` claims to track mergeability.
    expect(Object.keys(result.gates)).not.toContain("mergeable");
  });

  // ── Task #30 — CI gate ────────────────────────────────────────────

  it("#30a — no ciStatus supplied → gate is N/A, ok=true preserved", () => {
    const result = evaluateMergeGates(makePR(), []);
    expect(result.gates.ciPassed).toBe(true);
    expect(result.ciStatus).toBe(null);
    expect(result.ok).toBe(true);
    // No CI blocker leaked when the route doesn't pass a status.
    expect(result.blockers.some((b) => /\bCI\b/.test(b))).toBe(false);
  });

  it("#30b — ciStatus: success → gate passes", () => {
    const result = evaluateMergeGates(makePR(), [], { ciStatus: "success" });
    expect(result.gates.ciPassed).toBe(true);
    expect(result.ciStatus).toBe("success");
    expect(result.ok).toBe(true);
  });

  it("#30c — ciStatus: failure blocks merge with explicit blocker", () => {
    const result = evaluateMergeGates(makePR(), [], { ciStatus: "failure" });
    expect(result.gates.ciPassed).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      "CI failed — npm test broken on head SHA",
    );
  });

  it("#30d — ciStatus: pending blocks merge so we don't ship before tests finish", () => {
    const result = evaluateMergeGates(makePR(), [], { ciStatus: "pending" });
    expect(result.gates.ciPassed).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      "CI still running — wait for the test job to finish",
    );
  });

  it("#30e — ciStatus: missing blocks merge with the actionable hint", () => {
    const result = evaluateMergeGates(makePR(), [], { ciStatus: "missing" });
    expect(result.gates.ciPassed).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      "CI has not run on this commit — push triggers .github/workflows/ci.yml",
    );
  });

  it("#30f — explicit ciStatus: null is treated identically to omitted (gate N/A)", () => {
    const result = evaluateMergeGates(makePR(), [], { ciStatus: null });
    expect(result.gates.ciPassed).toBe(true);
    expect(result.ciStatus).toBe(null);
    expect(result.ok).toBe(true);
  });

  it("#30g — CI failure is independent of all other gates (stacks blockers)", () => {
    const result = evaluateMergeGates(
      {
        number: 1,
        title: "no marker",
        body: "totally empty body",
        head: { ref: "garbage-branch" },
      },
      [],
      { ciStatus: "failure" },
    );
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      "CI failed — npm test broken on head SHA",
    );
    // Other gate blockers still present alongside the CI one.
    expect(result.blockers).toContain(
      "Validation Tier missing from PR body",
    );
  });

  it("#9 — every blocker present in a worst-case PR (catches partial-failure regressions)", () => {
    const result = evaluateMergeGates(
      {
        number: 1,
        title: "no marker",
        body: "totally empty body",
        head: { ref: "garbage-branch" },
      },
      [],
    );

    expect(result.ok).toBe(false);
    // Every gate that COULD trigger should trigger.
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "Validation Tier missing from PR body",
        "Claim Level missing from PR body",
        "Validation Target missing from PR body",
        "Not in Scope missing from PR body",
        'Branch must start with "WARP/" (got "garbage-branch")',
        "WARP•FORGE output missing Report: line",
        "WARP•FORGE output missing State: line",
      ]),
    );
  });

  it("isSentinelPR detects the signature in title or body", () => {
    expect(isSentinelPR("WARP•SENTINEL: review", null)).toBe(true);
    expect(isSentinelPR("plain title", "body has WARP-SENTINEL inside")).toBe(
      true,
    );
    expect(isSentinelPR("plain title", "no signature here")).toBe(false);
    expect(isSentinelPR(null, null)).toBe(false);
  });
});

// ──────────────────────── extractPRAction ────────────────────────

describe("extractPRAction", () => {
  it("returns null action and the original raw when no marker is present", () => {
    const raw = "Hello, no marker here.";
    const { cleaned, action } = extractPRAction(raw);
    expect(action).toBeNull();
    expect(cleaned).toBe(raw);
  });

  it("parses `<!-- PR_ACTION: list -->` and strips the marker", () => {
    const raw = "Here are your PRs:\n\n<!-- PR_ACTION: list -->";
    const { cleaned, action } = extractPRAction(raw);
    expect(action).toEqual({ kind: "list" });
    expect(cleaned).toBe("Here are your PRs:");
  });

  it("parses `detail:N` / `merge:N` / `close:N` / `hold:N`", () => {
    expect(extractPRAction("x <!-- PR_ACTION: detail:7 -->").action).toEqual({
      kind: "detail",
      prNumber: 7,
    });
    expect(extractPRAction("x <!-- PR_ACTION: merge:42 -->").action).toEqual({
      kind: "merge",
      prNumber: 42,
    });
    expect(extractPRAction("x <!-- PR_ACTION: close:99 -->").action).toEqual({
      kind: "close",
      prNumber: 99,
    });
    expect(extractPRAction("x <!-- PR_ACTION: hold:3 -->").action).toEqual({
      kind: "hold",
      prNumber: 3,
    });
  });

  it("strips malformed markers (merge:abc) but mounts NO action", () => {
    const raw = "ack <!-- PR_ACTION: merge:abc -->";
    const { cleaned, action } = extractPRAction(raw);
    expect(action).toBeNull();
    expect(cleaned).toBe("ack");
  });

  it("strips unknown marker kinds (bogus:1) but mounts NO action", () => {
    const raw = "ack <!-- PR_ACTION: bogus:1 -->";
    const { cleaned, action } = extractPRAction(raw);
    expect(action).toBeNull();
    expect(cleaned).toBe("ack");
  });

  it("strips the bare `<!-- PR_ACTION: -->` shape and mounts no action", () => {
    const { cleaned, action } = extractPRAction("ack <!-- PR_ACTION: -->");
    expect(action).toBeNull();
    expect(cleaned).toBe("ack");
  });

  it("first well-formed marker wins; later markers are still stripped", () => {
    const raw =
      "Two markers: <!-- PR_ACTION: detail:1 --> and <!-- PR_ACTION: merge:2 -->";
    const { cleaned, action } = extractPRAction(raw);
    expect(action).toEqual({ kind: "detail", prNumber: 1 });
    expect(cleaned).toBe("Two markers:  and");
  });

  it("a malformed marker followed by a good one still yields the good one", () => {
    const raw =
      "ok <!-- PR_ACTION: merge:abc --> then <!-- PR_ACTION: merge:9 -->";
    const { cleaned, action } = extractPRAction(raw);
    expect(action).toEqual({ kind: "merge", prNumber: 9 });
    expect(cleaned).toBe("ok  then");
  });

  it("is case-insensitive on the kind token", () => {
    const { action } = extractPRAction("x <!-- PR_ACTION: MERGE:5 -->");
    expect(action).toEqual({ kind: "merge", prNumber: 5 });
  });

  it("rejects merge with prNumber 0 (must be > 0)", () => {
    const { cleaned, action } = extractPRAction(
      "x <!-- PR_ACTION: merge:0 -->",
    );
    expect(action).toBeNull();
    expect(cleaned).toBe("x"); // still stripped
  });
});
