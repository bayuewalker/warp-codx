# WARP•SENTINEL TASK: Phase 3c PR Panel Audit

=============
Repo         : https://github.com/bayuewalker/warp-codx
Branch       : WARP/pr-panel
Tier         : MAJOR
Source       : attached spec files

SENTINEL REQUIRED BECAUSE:
Phase 3c adds GitHub merge/close/hold write operations to
bayuewalker/walkermind-os. Wrong gate = bad code in production repo.
MAJOR tier mandatory per AGENTS.md.

═══════════════════════════════════════════════
AUDIT SCOPE — files to inspect
═══════════════════════════════════════════════

Primary (Phase 3c new files):
- src/lib/github-prs.ts
- src/lib/pr-gates.ts
- src/lib/pr-action-protocol.ts
- src/app/api/prs/list/route.ts
- src/app/api/prs/[number]/route.ts
- src/app/api/prs/[number]/merge/route.ts
- src/app/api/prs/[number]/close/route.ts
- src/app/api/prs/[number]/hold/route.ts
- src/components/PRCard.tsx
- src/components/PRListCard.tsx

Modified (Phase 3c touched):
- src/app/api/chat/route.ts (PR intent detection)
- src/components/ChatArea.tsx
- src/components/Sidebar.tsx
- src/components/MessageContent.tsx (extractPRAction)

═══════════════════════════════════════════════
AUDIT CHECKLIST
═══════════════════════════════════════════════

SECURITY (any failure = BLOCK merge):

S1: GITHUB_PAT_CONSTITUTION never hardcoded in src/.
    Search for literal github_pat_ or ghp_ strings.

S2: PAT never written to pr_actions, console logs, or any
    client-visible response. Check error handling paths —
    Octokit errors may include auth headers.

S3: All four /api/prs/* routes + /hold are admin-gated via
    isAdminAllowed. No bypass path.

S4: No force-push or destructive GitHub operations possible.
    Only: merge (squash), close, comment. Verify Octokit calls.

S5: Merge method is squash only. No rebase or merge-commit
    that could corrupt walkermind-os history.

GATE LOGIC (any failure = BLOCK merge):

G1: evaluateMergeGates is the SINGLE source of truth shared
    by PRCard UI checklist AND server hard-block in merge route.
    No parallel gate logic anywhere.

G2: SENTINEL PR gate — if PR detected as SENTINEL type,
    paired FORGE PR must be confirmed merged before merge allowed.
    Verify: detection regex tolerates WARP•SENTINEL / WARP·SENTINEL /
    WARP-SENTINEL / WARP.SENTINEL / WARP SENTINEL variants.

G3: forgeOutputComplete gate — PR body must contain Report: AND
    State: lines. Both checked unconditionally on all WARP/* PRs.
    Blocker strings must surface in card AND server 409 response.

G4: MAJOR tier gate — if Tier = MAJOR and no SENTINEL APPROVED/
    CONDITIONAL in reviews, merge blocked. Verify regex matches
    WARP•SENTINEL signature variants correctly.

G5: Branch format gate — branch must start with WARP/. Hard block.

G6: Manual HOLD — POST /hold posts GitHub comment, inserts
    pr_actions {action:"hold", verdict:"manual"}, does NOT change
    PR state on GitHub. PR stays open. Verify no state mutation.

G7: All gates appear in same gates.gates object that PRCard reads.
    No gate visible in UI but missing from server or vice versa.

CONSTITUTION SYNC (from COMMANDER.md):

C1: "cek pr" / "merge pr #N" / "close pr #N" / "hold pr #N"
    detected as operational triggers (not casual chat).

C2: DECISION: MERGE executes immediately — not just returns intent.
    Server merge route is the actual merge action.

C3: Post-merge response includes reminder:
    "Post-merge sync required: PROJECT_STATE.md + ROADMAP.md +
    WORKTODO.md + CHANGELOG.md"

C4: Ask Mr. Walker ONLY when: BLOCKED, MAJOR without SENTINEL,
    or conflicting bot reviews. Not for clean merges.

REGRESSION (Phase 3a/3b must be untouched):

R1: Constitution fetch (/api/chat system prompt) unchanged.
R2: Issue creation (/api/issues/create) unchanged.
R3: Sessions/messages streaming unchanged.
R4: No new npm dependencies beyond what #29 may have added.
R5: Visual design unchanged — status strip, header, session bar,
    chat area, input zone identical to v2 mockup.

═══════════════════════════════════════════════
REPORT PATH
═══════════════════════════════════════════════

Deliver report at:
docs/reports/sentinel/phase-3c-pr-panel.md
(create docs/reports/sentinel/ if not exists)

Report format:
WARP•SENTINEL AUDIT REPORT
Branch: WARP/pr-panel
Tier: MAJOR
Date: [Asia/Jakarta timestamp]
Score: [X]/100
Critical findings: [N]

[PASS/FAIL] S1: ...
[PASS/FAIL] S2: ...
[PASS/FAIL] S3: ...
[PASS/FAIL] S4: ...
[PASS/FAIL] S5: ...
[PASS/FAIL] G1: ...
[PASS/FAIL] G2: ...
[PASS/FAIL] G3: ...
[PASS/FAIL] G4: ...
[PASS/FAIL] G5: ...
[PASS/FAIL] G6: ...
[PASS/FAIL] G7: ...
[PASS/FAIL] C1: ...
[PASS/FAIL] C2: ...
[PASS/FAIL] C3: ...
[PASS/FAIL] C4: ...
[PASS/FAIL] R1-R5: ...

VERDICT: APPROVED / CONDITIONAL / BLOCKED
If BLOCKED: list exact items that must be fixed before merge.

═══════════════════════════════════════════════
DONE CRITERIA FOR SENTINEL
═══════════════════════════════════════════════

- All Security checks (S1-S5): PASS
- All Gate Logic checks (G1-G7): PASS
- All Regression checks (R1-R5): PASS
- Score >= 85/100
- Zero Critical findings
- Report at docs/reports/sentinel/phase-3c-pr-panel.md

NEXT GATE: Return verdict to WARP🔹CMD.
If APPROVED → Mr. Walker merges WARP/pr-panel → main.
If BLOCKED → WARP🔹CMD consolidates fix task for WARP•FORGE.
