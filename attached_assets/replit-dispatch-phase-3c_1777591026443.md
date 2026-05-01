PHASE 3c — PR PANEL + REVIEW ACTIONS

This is a MAJOR-tier feature. Branch: WARP/pr-panel.

Pre-requirements VERIFIED:
- ✅ GITHUB_PAT_CONSTITUTION expanded — Pull requests: Read and write added
- ✅ PAT verified via curl — HTTP 200 on pulls list
- ✅ Supabase table pr_actions created
- ✅ Phase 3a (constitution fetch) working
- ✅ Phase 3b (issue creator) working

OBJECTIVE
Give WARP🔹CMD the ability to execute PR review actions directly from WARP CodX
chat — synced with COMMANDER.md shortcut commands and PR review flow.

When CMD says merge, it actually merges. When CMD says close, it closes.
No confirmation needed from Mr. Walker when gates pass — CMD executes autonomously
per COMMANDER.md AUTO PR ACTION RULE.

Success: Mr. Walker types "cek pr" → CMD lists WARP/* PRs → "merge pr #42" →
CMD runs pre-merge checklist → executes merge via GitHub API → "✅ PR #42 merged"

═══════════════════════════════════════════════
CRITICAL: CONSTITUTION SYNC (implement exactly)
═══════════════════════════════════════════════

This feature must mirror COMMANDER.md behavior exactly. Read these rules carefully:

1. SHORTCUT COMMANDS (from COMMANDER.md):
   "cek pr"   → list all WARP/* open PRs with tier + gate state
   "merge pr" / "merge pr #N" → inspect → run gates → execute merge if clean
   "close pr" / "close pr #N" → inspect → close if justified → post reason

2. AUTO PR ACTION RULE (from COMMANDER.md — CRITICAL):
   DECISION: MERGE → execute merge API call immediately (not just state intent)
   DECISION: CLOSE → execute close API call immediately
   DECISION: HOLD  → state reason, no action
   Mr. Walker confirmation NOT required when gates are clean.
   Ask Mr. Walker ONLY when: gate is BLOCKED, MAJOR without SENTINEL, or
   conflicting bot reviews exist.

3. PRE-MERGE GATES (server-side hard blocks):
   - Validation Tier declared in PR body
   - Claim Level declared in PR body
   - Validation Target declared in PR body
   - Not in Scope declared in PR body
   - Branch format starts with WARP/
   - If MAJOR tier → WARP•SENTINEL must have issued APPROVED or CONDITIONAL
   - If WARP•SENTINEL PR → related WARP•FORGE PR already merged

   AUTO-MERGE NOT ALLOWED when:
   - Tier = MAJOR and SENTINEL not yet approved
   - WARP•FORGE output missing Report:/State:/Validation Tier: lines
   - SENTINEL verdict = BLOCKED

4. PRE-REVIEW DRIFT CHECK (run before every merge):
   - branch name valid (WARP/{feature} format)
   - Validation Tier / Claim Level / Validation Target / Not in Scope all declared

5. POST-MERGE (from COMMANDER.md):
   After merge, CMD must output:
   "Post-merge sync required: update PROJECT_STATE.md + ROADMAP.md +
    WORKTODO.md + CHANGELOG.md for WARP/{feature}"

═══════════════════════════════════════════════
ARCHITECTURE
═══════════════════════════════════════════════

INTENT DETECTION (server-side in /api/chat):
- "cek pr" / "list pr" / "check pr" → PR_LIST
- "merge pr #N" / "merge pr" → PR_MERGE
- "close pr #N" / "close pr" → PR_CLOSE
- "review pr #N" / "pr #N" → PR_DETAIL

Append <!-- PR_ACTION: {action}:{number} --> to CMD response.
Client renders PRCard / PRListCard from marker.

MERGE GATE LOGIC (/api/prs/[number]/merge):
- Parse PR body for Tier/Claim/Target/NotInScope
- Check branch startsWith('WARP/')
- If MAJOR: check reviews for SENTINEL APPROVED/CONDITIONAL
- All pass → execute Octokit merge (squash)
- Any fail → return { status: 'HOLD', blockers: [...] }

═══════════════════════════════════════════════
DELIVERABLES
═══════════════════════════════════════════════

Files to CREATE:
- src/lib/github-prs.ts
- src/app/api/prs/list/route.ts
- src/app/api/prs/[number]/route.ts
- src/app/api/prs/[number]/merge/route.ts
- src/app/api/prs/[number]/close/route.ts
- src/components/PRCard.tsx
- src/components/PRListCard.tsx

Files to MODIFY:
- src/app/api/chat/route.ts
- src/components/ChatArea.tsx
- src/components/Sidebar.tsx (wire Pull Requests nav item)

═══════════════════════════════════════════════
PR CARD UI SPEC
═══════════════════════════════════════════════

COLLAPSED:
🔀 #42 Add wallet validation guard
   WARP/wallet-guard · STANDARD · OPEN · +47 −12 · 2h ago
   [VIEW DETAILS ›]

EXPANDED:
🔀 PR #42 — Add wallet validation guard
Branch: WARP/wallet-guard | Type: WARP•FORGE | Tier: STANDARD
PRE-MERGE CHECKS:
✅ Tier · ✅ Claim · ✅ Branch WARP/ · ✅ STANDARD no SENTINEL needed
[CLOSE ×]  [HOLD ⏸]  [MERGE ✓]

AFTER MERGE:
✅ PR #42 MERGED — Add wallet validation guard
Merged by WARP🔹CMD via WARP CodX
[OPEN IN GITHUB ↗]

CEK PR output:
📋 OPEN PRs — WARP/* · 2 open
🔀 #42 wallet-guard  STANDARD  [VIEW]
🔀 #41 fix-pr-loop   STANDARD  [VIEW]
[REFRESH]

Visual: purple left-border (var(--warp-purple)), bg-elev-1, rounded-md.
DO NOT change existing design.

═══════════════════════════════════════════════
DONE CRITERIA — VERIFY ALL 8
═══════════════════════════════════════════════

1. ✅ "cek pr" → lists WARP/* PRs with tier + status
2. ✅ "merge pr #N" → gates run → merge executes → confirms merged
3. ✅ MAJOR tier without SENTINEL → HOLD, merge blocked
4. ✅ "close pr #N" → posts reason → closes → confirms
5. ✅ Row in pr_actions table after each action
6. ✅ Pull Requests drawer nav → PRListView with live data
7. ✅ Gates: Tier/Claim/Target/NotInScope + WARP/ branch format
8. ✅ No regression

═══════════════════════════════════════════════
HARD CONSTRAINTS
═══════════════════════════════════════════════

- DO NOT change visual design
- DO NOT add npm dependencies (Octokit already installed)
- DO NOT use GITHUB_PAT_TOKEN — use GITHUB_PAT_CONSTITUTION
- DO NOT allow merge without all gate checks passing
- DO NOT allow force-push
- pr_actions table already exists — DO NOT re-run CREATE TABLE
- Merge method: squash

═══════════════════════════════════════════════
VALIDATION TIER: MAJOR
WARP•SENTINEL audit required after implementation.
═══════════════════════════════════════════════

PROCESS:
1. Read spec below
2. Generate plan
3. WAIT for approval
4. Execute
5. Verify 8 done criteria
6. Report done — SENTINEL audit follows

═══════════════════════════════════════════════
SPEC START
═══════════════════════════════════════════════

[PASTE FULL CONTENT OF phase-3c-pr-panel-spec.md HERE]

═══════════════════════════════════════════════
SPEC END
═══════════════════════════════════════════════

Generate implementation plan now. Wait for approval before coding.
