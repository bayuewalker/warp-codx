# WARP•SENTINEL Audit — Phase 3c PR Panel

- **Branch:** `WARP/pr-panel`
- **Validation Tier:** MAJOR
- **Audit date:** 2026-05-01
- **Auditor:** WARP•SENTINEL (read-only inspection)
- **Scope:** 16 checklist items across Security (S1–S5), Gate Logic (G1–G7),
  Constitution Sync (C1–C4), Regression (R1–R5)
- **In-scope code:**
  - `src/lib/github-prs.ts` (561 LOC)
  - `src/lib/pr-gates.ts` (294 LOC)
  - `src/lib/pr-action-protocol.ts` (93 LOC)
  - `src/lib/pr-action-extract.ts` (77 LOC)
  - `src/app/api/prs/list/route.ts`
  - `src/app/api/prs/[number]/route.ts`
  - `src/app/api/prs/[number]/merge/route.ts`
  - `src/app/api/prs/[number]/close/route.ts`
  - `src/app/api/prs/[number]/hold/route.ts`
  - `src/components/PRCard.tsx` (875 LOC)
  - `src/components/PRListCard.tsx` (191 LOC)
  - `src/components/MessageContent.tsx` (231 LOC)
  - `src/components/ChatArea.tsx` (sessionId threading)
  - `src/app/api/chat/route.ts` (PR_ACTION_PROTOCOL appended)
  - `.github/workflows/ci.yml` (Task #30 CI gate)

---

## Verdict — APPROVED

| Dimension     | Score      |
| ------------- | ---------- |
| Security      | 25 / 25    |
| Gate logic    | 35 / 35    |
| Constitution  | 20 / 20    |
| Regression    | 20 / 20    |
| **TOTAL**     | **100/100**|

- **Critical findings:** 0
- **High findings:** 0
- **Medium findings:** 0
- **Low / informational:** 1 (see Observations)
- **Test surface:** 101/101 passing across 4 files (`pr-gates.test.ts` 37,
  `github-prs.test.ts` 38, `github.test.ts` 13, `constitution.test.ts` 13)

The Phase 3c PR Panel is cleared for production. The PAT-fronted surface is
sealed, the merge gate is a single source of truth honoured by both card and
server, the CI gate wires `.github/workflows/ci.yml` → `evaluateMergeGates`
end-to-end, and the prior-phase constitution / issue-creation modules are
untouched.

---

## S — Security (25 / 25)

### S1 — PAT never leaks via error path · PASS

`src/lib/github-prs.ts:536-560` — every Octokit/network throw is funnelled
through `sanitize(err, op)` which constructs a fixed-shape message
`github_<op>_<status>: <name>: <message>` and truncates the raw message to
300 chars. The raw `err` object (which carries the auth header in
`error.response.headers`) is never re-thrown.

- 403 on `merge` is special-cased to a static PAT-scope hint string — no
  upstream content echoed.
- 405 on `merge` is special-cased to a static "not mergeable" string.
- All five callers (`listWarpPRs`, `getPRDetail`, `mergePR`, `closePR`,
  `holdPR`, `findPairedForgePR`) wrap their try blocks the same way.
- `getPRCheckStatus` swallows the raw error entirely and degrades to
  `"missing"` (the safest default — surfaces as a gate blocker, never silent
  pass).
- No `console.log` / `console.error` in `github-prs.ts` (verified via
  ripgrep). The route-level `audit()` helpers log only the supabase error
  message, which is unrelated to GitHub.
- Test coverage: `github-prs.test.ts:618` asserts the test PAT literal
  `ghp_test_token_value` does NOT appear in any thrown error message; same
  guarantee in `github.test.ts:181` and `constitution.test.ts:280`.

### S2 — PAT only via `process.env.GITHUB_PAT_CONSTITUTION` · PASS

`src/lib/github-prs.ts:32-49` — `getClient()` is the single read site,
guarded by a thrown error when the env var is unset. No hardcoded
`github_pat_*` / `ghp_*` literals in production source (the only matches in
ripgrep are in `*.test.ts` files using a controlled `ghp_test_token_value`
mock). Three independent lazy clients (`github.ts`, `github-issues.ts`,
`github-prs.ts`) all read the same env var — sharing the secret without
sharing module state, exactly per spec.

### S3 — All `/api/prs/*` routes admin-gated · PASS

| Route                              | `isAdminAllowed(req)` call              |
| ---------------------------------- | --------------------------------------- |
| `GET  /api/prs/list`               | `list/route.ts:37`                      |
| `GET  /api/prs/[number]`           | `[number]/route.ts:44`                  |
| `POST /api/prs/[number]/merge`     | `[number]/merge/route.ts:85`            |
| `POST /api/prs/[number]/close`     | `[number]/close/route.ts:69`            |
| `POST /api/prs/[number]/hold`      | `[number]/hold/route.ts:71`             |

All five short-circuit with `403 forbidden` before any GitHub or Supabase
I/O. The gate (`src/lib/adminGate.ts`) is permissive in dev/preview and
requires the `x-warp-admin-token` header in production — matching the
existing `/api/issues/*` and `/api/constitution/clear` posture.

### S4 — Squash-only merge with canonical commit title · PASS

`src/lib/github-prs.ts:251-272` — `mergePR()` calls
`octokit.rest.pulls.merge` with hardcoded `merge_method: "squash"` and
`commit_title: \`Merged WARP/${branchSlug} via WARP CodX\``. Ripgrep
confirms `merge_method` appears in only two places: the production call and
the test assertion `github-prs.test.ts:330` that pins it to `"squash"`. The
merge route never accepts a merge-method parameter from the client.

### S5 — No raw GitHub error reaches the client · PASS

Every route's catch block surfaces `err instanceof Error ? err.message :
"…fallback…"`. Because every error originating in `github-prs.ts` is built
by `sanitize()`, the only strings the client can see are the fixed-shape
`github_<op>_<status>: <name>: <message>` envelopes (or the static 403/405
hints). Routes additionally hard-code their HTTP status from the parsed
error (`/\b404\b/.test(message) ? 404 : 500`) rather than echoing
upstream status fields.

---

## G — Gate Logic (35 / 35)

### G1 — `evaluateMergeGates` is the single source of truth · PASS

The same pure function is invoked by exactly two callers with identical
input shapes (PR detail, normalized reviews, `{ forgePRMerged, ciStatus
}`):

- `src/app/api/prs/[number]/route.ts:79` — feeds the PRCard checklist.
- `src/app/api/prs/[number]/merge/route.ts:160` — re-runs server-side
  immediately before invoking `mergePR()`.

The merge route does NOT trust any gate state from the client; it
re-fetches PR + reviews + paired-FORGE + CI fresh on every call (lines
112-169). Marker protocol can pre-select the action in the UI but cannot
bypass the server gate.

### G2 — Tier / Claim / Target / NotInScope all required · PASS

`src/lib/pr-gates.ts:141-146,215-218,241-246` — four independent
case-insensitive regex checks (`TIER_RE`, `CLAIM_RE`, `TARGET_RE`,
`NOT_IN_SCOPE_RE`), each emitting a distinct blocker string. Test coverage
in `pr-gates.test.ts:101-121`.

### G3 — Branch format hardened · PASS

`src/lib/pr-gates.ts:171-178` — `isBranchFormatOk` rejects:

1. Refs not starting with `WARP/`.
2. Refs containing whitespace (`/\s/`).
3. Refs containing `..` sequences (path-traversal-shaped).
4. Refs of length ≤ `WARP/`.

Passes only when all four conditions hold. Tested in
`pr-gates.test.ts:142-164`.

### G4 — MAJOR requires SENTINEL APPROVED/CONDITIONAL review · PASS

`src/lib/pr-gates.ts:180-189,222-223` — `hasSentinelApproval()` requires
ALL THREE: review `state === "APPROVED"`, body matches `SENTINEL_SIG_RE`
(tolerant signature), AND body matches `SENTINEL_VERDICT_RE` (`\b(APPROVED|
CONDITIONAL)\b`). Non-MAJOR PRs short-circuit to `true` so the gate
correctly reports N/A. CHANGES_REQUESTED / DISMISSED / COMMENTED reviews
cannot satisfy. Tested in `pr-gates.test.ts:185-228`.

### G5 — SENTINEL→FORGE pairing prevents bypass · PASS

`src/lib/github-prs.ts:313-434,findPairedForgePR()` enforces the strict
identity rule:

- `Pairs: #N` is only trusted when `candidates.length > 0` (i.e. the
  branch follows the `-sentinel` convention OR the body has an explicit
  `Pairs: WARP/<ref>` hint) AND the resolved PR's head ref appears in the
  candidate set.
- A bare `Pairs: #N` with no convention/ref hint is silently ignored —
  closing the bypass where an unrelated merged WARP/* PR could be claimed
  as the pair.
- Pure evaluator stays I/O-free: `pr-gates.ts:232-233,255-263` consumes
  the resolved boolean; routes do the I/O. Surfaces three distinct
  blocker strings: `paired WARP•FORGE PR could not be resolved`,
  `paired WARP•FORGE PR not yet merged`, or N/A.

### G6 — WARP•FORGE output markers required · PASS

`src/lib/pr-gates.ts:149-150,227-229,251-252` — `Report:` and `State:`
lines are independently required and emit independent blockers. Applies
to every WARP/* PR (not just SENTINEL).

### G7 — CI gate (Task #30) wired end-to-end · PASS

- `.github/workflows/ci.yml` defines `jobs.test` running `tsc --noEmit`
  + `npm test` on every push/PR.
- `src/lib/github-prs.ts:498-527` `getPRCheckStatus(headSha, "test")`
  consults the named check-run for the head SHA and returns
  `success`/`failure`/`pending`/`missing`. Network failure degrades to
  `"missing"` (safe-default — gate blocks, never silent passes).
- `src/lib/pr-gates.ts:237-238` `ciPassed` is true only when CI is
  `"success"` or skipped (`null`). `pending`/`failure`/`missing` all
  emit distinct, actionable blocker strings.
- The merge route re-queries CI fresh on the merge call
  (`merge/route.ts:157`), not trusting the card's snapshot — handles
  the `pending → success` race correctly. Tested in
  `pr-gates.test.ts:317-358`.

---

## C — Constitution / Protocol Sync (20 / 20)

### C1 — `PR_ACTION_PROTOCOL` appended additively · PASS

`src/app/api/chat/route.ts:143` —
`systemPrompt = ${systemPrompt}\n${PR_ACTION_PROTOCOL}` runs AFTER the
existing `${ISSUE_DRAFT_PROTOCOL}` append, immediately after the live
constitution build. Constitution-fetch layer (`src/lib/constitution.ts`,
`src/lib/github.ts`) is not touched by Phase 3c — verified by ripgrep
showing zero edits to those files in the diff. Honors the hard
"don't touch prior-phase code" constraint.

### C2 — Marker shape stable and parser fault-tolerant · PASS

`src/lib/pr-action-protocol.ts:42-49` enumerates exactly five markers:
`list`, `detail:N`, `merge:N`, `close:N`, `hold:N`.
`src/lib/pr-action-extract.ts:45-77` uses a two-pass design: a permissive
`STRIP_RE` removes any `<!-- PR_ACTION: ... -->` shape (including
malformed ones) so protocol artifacts never leak into rendered prose,
then a strict `PARSE_RE` only mounts a card when the marker is
well-formed. `MessageContent.tsx:111-117` runs both `extractIssueDraft`
and `extractPRAction` independently against assistant messages; both
strippers are commutative. Tested in `pr-gates.test.ts:359-391` (PR
extractor section of the same file).

### C3 — Post-merge reminder string canonical · PASS

The exact string
`Post-merge sync required: update PROJECT_STATE.md + ROADMAP.md +
WORKTODO.md + CHANGELOG.md for WARP/${slug}`
appears identically in:

- `src/app/api/prs/[number]/route.ts:93` (detail response →
  `postMergeReminder` field consumed by PRCard).
- `src/app/api/prs/[number]/merge/route.ts:220` (200 success response →
  surfaced in the `merged` card state at `PRCard.tsx:335`).
- `src/lib/pr-action-protocol.ts:66-67` instructs CMD to print the line
  in prose post-merge.

The card's merged state echoes whichever `postMergeReminder` came back
from the merge response, falling back to the detail snapshot — so the
operator sees the correct branch slug regardless.

### C4 — HOLD is a pure soft-pause · PASS

`src/lib/github-prs.ts:280-296,holdPR()` calls ONLY
`octokit.rest.issues.createComment` (no `pulls.update`). The PR remains
`open` on GitHub. The route (`hold/route.ts`) inserts an audit row with
`verdict: "manual"` to keep operator-tapped HOLDs distinguishable from
gate-blocked HOLDs (`verdict: "blocked"` on the merge route's 409 path).
The PRCard renders a distinct sub-label "Manual hold — operator-tapped"
vs "Pre-merge gate blocked" (`PRCard.tsx:373-378`).

---

## R — Regression (20 / 20)

### R1 — Phase 3a / 3b code untouched · PASS

`github-prs.ts` is a third independent module alongside `github.ts`
(Phase 3a constitution fetch) and `github-issues.ts` (Phase 3b issue
create); each owns its own lazy Octokit client. The only edit to a
prior-phase file is `chat/route.ts:143` which appends the new protocol
to the system prompt — additive, no constitution layer mutation.

### R2 — SENTINEL signature regex tolerates encoding drift · PASS

`src/lib/pr-gates.ts:157` — `WARP[\u2022\u00b7\.\-\s]*SENTINEL` accepts
`•` (U+2022), `·` (U+00B7), `-`, `.`, or whitespace between the two
tokens. Same tolerance pattern proven in Phase 3a survives the
diamond/bullet character-mangling that happens during copy-paste. Tested
in `pr-gates.test.ts:218-226`.

### R3 — `ciStatus` null preserves backward compatibility · PASS

`src/lib/pr-gates.ts:99,237-238,86-104` — `ciStatus` is optional. When
the route doesn't pass it (or passes `null`), `ciPassed === true` and
the gate is skipped silently. All pre-Task-30 tests in
`pr-gates.test.ts` still pass (37 assertions including #1–#11 from the
original Phase 3c plan plus the new CI assertions). The PRCard renders
a "CI: status unavailable (gate skipped)" row in this case (`PRCard.tsx`
`ciGateLabel:768-775`) so the operator still understands the state.

### R4 — Card and server agree on gate state · PASS

Both the `[number]/route.ts` (powering the PRCard) and the
`[number]/merge/route.ts` (server enforcement) call `evaluateMergeGates`
with identical input construction:

```
{ number, title, body, head: { ref: branch } }
+ reviews.map(r => ({ state, body }))
+ { forgePRMerged, ciStatus }
```

The merge route re-fetches PR + reviews + paired-FORGE + CI fresh on
every call (`merge/route.ts:114,143-157`), so any race between card
render and merge tap is resolved server-side using the latest GitHub
state. The PRCard's MERGE button is disabled when `gates.ok === false`
(`PRCard.tsx:658`) but the server still re-runs the gate even if the
disabled state were bypassed.

### R5 — Test surface comprehensive and CI-enforced · PASS

```
 ✓ src/lib/__tests__/constitution.test.ts (13 tests)
 ✓ src/lib/pr-gates.test.ts                (37 tests)
 ✓ src/lib/github-prs.test.ts              (38 tests)
 ✓ src/lib/github.test.ts                  (13 tests)
 Test Files  4 passed (4)
      Tests  101 passed (101)
```

`.github/workflows/ci.yml` runs `tsc --noEmit` + `npm test` on every
push/PR and is the same `test` job consumed by the merge gate
(`getPRCheckStatus("test", ...)`). Adapter tests (`github-prs.test.ts`)
cover all five Octokit wrappers including the strict `findPairedForgePR`
identity rule, the `getPRCheckStatus` failure-mode degradation, the
sanitization contract for every op (PAT non-leakage assertion at line
618), and the squash-only merge constraint at line 330.

---

## Observations (informational, not blockers)

### O1 — Audit-row failures are best-effort · LOW

`merge/route.ts:64-78`, `close/route.ts:39-62`, `hold/route.ts:41-64` —
when the Supabase audit insert fails, the route logs a `console.error`
and returns success anyway. This is correct (an audit failure must not
undo a completed GitHub merge), but it does mean a future operator
forensic could find a merge with no `pr_actions` row. Suggest a
follow-up to surface failed audit inserts via `chat_warnings` (info
level) so the chat surface can flag them. Not in scope for Phase 3c.

---

## Sign-off

> WARP•SENTINEL — APPROVED for merge.
>
> Phase 3c PR Panel meets all 16 checklist items. Merge gate is the
> single source of truth shared by card and server, PAT remains sealed
> behind sanitized error envelopes, the SENTINEL→FORGE pairing rule
> closes the bypass window, the CI gate wires `.github/workflows/ci.yml`
> through to `evaluateMergeGates`, and prior-phase code is untouched.
> Squash-merge `WARP/pr-panel` with the canonical commit title.
>
> Post-merge sync required: update PROJECT_STATE.md + ROADMAP.md +
> WORKTODO.md + CHANGELOG.md for WARP/pr-panel.
