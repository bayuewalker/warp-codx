# PHASE 3c — PR Panel + Review Actions

> **Spec version:** 1.0
> **Date:** 2026-04-30
> **Branch target:** `WARP/pr-panel`
> **Validation tier:** MAJOR
> **Dispatch to:** Replit Agent

---

## OBJECTIVE

Give WARP🔹CMD the ability to execute PR review actions (cek pr / merge pr / close pr)
directly from WARP CodX chat — synced with COMMANDER.md shortcut commands and
PR review flow. When CMD says merge, it actually merges. When CMD says close, it closes.

**Success metric:** Mr. Walker types "cek pr" in WARP CodX → CMD lists all open
WARP/* PRs with status → Mr. Walker says "merge pr #42" → CMD runs pre-merge
checklist → executes merge via GitHub API → confirms "✅ PR #42 merged".

---

## CONSTITUTION SYNC (MANDATORY — read before implementing)

Phase 3c must mirror COMMANDER.md exactly for these flows:

### Shortcut commands (from COMMANDER.md)

```
cek pr   → List all open PRs with current status, tier, and gate state.
           Flag any traceability or state drift visible from PR context.

merge pr → Inspect PR against all merge gates.
           Decide merge, hold, or rework.
           Execute merge when gate-clean.
           Immediately perform post-merge sync review.

close pr → Inspect PR.
           Decide if closure is justified.
           Close PR when justified.
           Post closure reason.
           Identify replacement lane if needed.
```

### PR review flow (from COMMANDER.md — must be implemented exactly)

```
1. Read PR metadata, files changed, reviews, comments
2. Identify PR type: WARP•FORGE / WARP•SENTINEL / WARP•ECHO
3. Read Validation Tier, Claim Level, Validation Target, Not in Scope
4. Run pre-review drift check
5. Decide: merge / hold / close / needs-fix
6. Execute immediately — "DECISION: MERGE" is not a merge. The API call is the merge.
```

### Pre-merge checklist (from COMMANDER.md — CMD must verify ALL before merge)

```
- PR type identified
- Validation Tier declared
- Claim Level declared
- Validation Target declared
- Not in Scope declared
- state/PROJECT_STATE.md truth preserved
- If WARP•SENTINEL PR → related WARP•FORGE merge status confirmed
- If MAJOR tier → WARP•SENTINEL must have issued APPROVED or CONDITIONAL
```

### Auto-merge NOT allowed when (from COMMANDER.md)

```
- Tier = MAJOR and WARP•SENTINEL has not issued APPROVED or CONDITIONAL
- Drift exists between state/PROJECT_STATE.md / ROADMAP.md / code truth
- WARP•FORGE output missing Report: / State: / Validation Tier: lines
- WARP•SENTINEL verdict = BLOCKED
```

### Pre-review drift check (from COMMANDER.md)

```
Before approving any PR, verify:
- imports resolve
- adapters / facades wrap real logic — no fake abstractions
- report claims match implementation reality
- branch name in forge report matches actual PR head branch exactly
- state/PROJECT_STATE.md branch reference matches actual PR head branch exactly
- branch format valid per AGENTS.md (WARP/{feature})
- state/PROJECT_STATE.md does not lose unresolved truth
- Validation Tier / Claim Level / Validation Target / Not in Scope all declared
```

### WARP•SENTINEL activation rule (from AGENTS.md)

```
SENTINEL runs ONLY for MAJOR tier.
SENTINEL NOT ALLOWED for STANDARD tier.
If CMD detects MAJOR PR without SENTINEL verdict → HOLD, request SENTINEL first.
```

---

## ARCHITECTURE

### CMD intent detection → PR action routing

```
User message
    ↓
CMD detects PR-action intent:
  - "cek pr" / "check pr" / "list pr" → PR_LIST
  - "merge pr" / "merge pr #N" → PR_MERGE
  - "close pr" / "close pr #N" → PR_CLOSE
  - "review pr #N" → PR_REVIEW
    ↓
Route to /api/prs/[action]
    ↓
Octokit API calls → walkermind-os
    ↓
CMD renders structured response in chat (PRCard / PRReviewCard)
```

### PR data flow

```
GET /api/prs/list
  → Octokit: list PRs filtered by WARP/* branches
  → Return: PR list with metadata + Validation Tier (parsed from body)

GET /api/prs/[number]
  → Octokit: get PR + files changed + reviews + comments
  → Parse: Validation Tier, Claim Level, Validation Target, Not in Scope
  → Run: pre-review drift check
  → Return: full PR context

POST /api/prs/[number]/merge
  → Pre-merge checklist (all gates)
  → If gates pass: Octokit merge
  → If gates fail: return HOLD with reason

POST /api/prs/[number]/close
  → Octokit close PR + post reason comment
```

---

## PAT SCOPE EXPANSION

Existing `GITHUB_PAT_CONSTITUTION`:
- ✅ `Contents: Read-only` (Phase 3a)
- ✅ `Issues: Read and write` (Phase 3b)

Phase 3c additions:
- ✅ `Pull requests: Read and write` ← NEW
- ✅ `Metadata: Read-only` (already included)

**Mr. Walker action (before dispatch):**
Edit `WARP CodX — Constitution Read` PAT at:
https://github.com/settings/personal-access-tokens

Add permission: **Pull requests: Read and write**
→ Regenerate token → update `GITHUB_PAT_CONSTITUTION` in Replit Secrets

---

## SCOPE

### Files to CREATE

```
src/lib/github-prs.ts              — Octokit wrapper for PR operations
src/app/api/prs/list/route.ts      — GET list WARP/* PRs
src/app/api/prs/[number]/route.ts  — GET single PR with full context
src/app/api/prs/[number]/merge/route.ts  — POST merge PR
src/app/api/prs/[number]/close/route.ts  — POST close PR
src/components/PRCard.tsx           — Inline PR card in chat (collapsed → expand)
src/components/PRListView.tsx       — Standalone PR list in drawer
```

### Files to MODIFY

```
src/app/api/chat/route.ts     — detect PR-action intent → inject PRCard/PRList
src/components/ChatArea.tsx   — render PRCard / PRListView from CMD response
src/components/Sidebar.tsx    — wire Pull Requests nav item → PRListView
```

### Supabase (new table)

```sql
create table if not exists public.pr_actions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete set null,
  pr_number int not null,
  action text not null check (action in ('merge', 'close', 'review', 'hold')),
  verdict text,
  reason text,
  performed_at timestamptz not null default now()
);

alter table public.pr_actions disable row level security;

create index if not exists idx_pr_actions_session
  on public.pr_actions (session_id, performed_at desc);
```

---

## PR CARD UI SPEC

### Collapsed state (default — inline in chat)

```
┌──────────────────────────────────────────────────┐
│ 🔀  #42 Add wallet validation guard              │
│     WARP/wallet-guard · STANDARD · OPEN          │
│     +47 −12 · bayuewalker · 2h ago              │
│                                                  │
│ [VIEW DETAILS ›]                                 │
└──────────────────────────────────────────────────┘
```

### Expanded state (tap VIEW DETAILS)

```
┌──────────────────────────────────────────────────┐
│ 🔀  PR #42 — Add wallet validation guard         │
│─────────────────────────────────────────────────│
│ Branch:    WARP/wallet-guard                     │
│ Type:      WARP•FORGE                            │
│ Tier:      STANDARD                              │
│ Claim:     NARROW INTEGRATION                    │
│ Target:    risk/wallet_guard.py                  │
│ Not scope: execution logic, strategy             │
│                                                  │
│ PRE-MERGE CHECKS:                                │
│ ✅ Validation Tier declared                      │
│ ✅ Claim Level declared                          │
│ ✅ Branch format valid (WARP/)                   │
│ ✅ STANDARD — no SENTINEL required               │
│ ⚠️ PROJECT_STATE.md sync: unverified            │
│                                                  │
│ [CLOSE ×]    [HOLD ⏸]    [MERGE ✓]             │
└──────────────────────────────────────────────────┘
```

### After merge

```
┌──────────────────────────────────────────────────┐
│ ✅  PR #42 MERGED                                │
│     Add wallet validation guard                  │
│     Merged by WARP🔹CMD via WARP CodX           │
│     github.com/bayuewalker/walkermind-os/pull/42 │
│                                                  │
│ [OPEN IN GITHUB ↗]                              │
└──────────────────────────────────────────────────┘
```

### After close

```
┌──────────────────────────────────────────────────┐
│ ❌  PR #42 CLOSED                                │
│     Add wallet validation guard                  │
│     Reason: [CMD's reason for close]             │
│     Replacement lane: [if identified]            │
└──────────────────────────────────────────────────┘
```

### HOLD state

```
┌──────────────────────────────────────────────────┐
│ ⏸  PR #42 HELD                                  │
│     Add wallet validation guard                  │
│     Reason: MAJOR tier — WARP•SENTINEL           │
│     required before merge                        │
│                                                  │
│ Required: WARP•SENTINEL APPROVED verdict         │
└──────────────────────────────────────────────────┘
```

### Visual style

- Matches existing card patterns (bg-elev-1, border-soft, rounded-md)
- Purple left-border (2px) for PR type — `var(--warp-purple)`
- Status colors: teal=merged, red=closed, amber=hold, blue=open
- DO NOT change any existing visual design

---

## CEK PR — FULL LIST VIEW (CMD response)

When CMD detects "cek pr", render PRListCard in chat:

```
┌──────────────────────────────────────────────────┐
│ 📋  OPEN PRs — WARP/*                   2 open  │
│─────────────────────────────────────────────────│
│ 🔀 #42  wallet-guard    STANDARD  OPEN  [VIEW]  │
│ 🔀 #41  fix-pr-loop     STANDARD  OPEN  [VIEW]  │
│                                                  │
│ [REFRESH]                [OPEN ALL IN GITHUB ↗] │
└──────────────────────────────────────────────────┘
```

---

## MERGE GATE LOGIC (server-side — /api/prs/[number]/merge)

Server must run ALL gates before executing merge:

```typescript
// Run pre-merge checklist — block if any fail
const gates = {
  tierDeclared:   pr.body.includes('Validation Tier'),
  claimDeclared:  pr.body.includes('Claim Level'),
  targetDeclared: pr.body.includes('Validation Target'),
  notInScope:     pr.body.includes('Not in Scope'),
  branchFormat:   pr.head.ref.startsWith('WARP/'),
  // MAJOR tier = SENTINEL required
  sentinelApproved: tier !== 'MAJOR' || hasSentinelApproval(reviews),
}

const blocked = Object.entries(gates)
  .filter(([_, pass]) => !pass)
  .map(([key]) => key)

if (blocked.length > 0) {
  return { status: 'HOLD', blockers: blocked }
}

// All gates pass — execute merge
await octokit.pulls.merge({
  owner: 'bayuewalker',
  repo: 'walkermind-os',
  pull_number: prNumber,
  commit_title: `Merged WARP/${slug} via WARP CodX`,
  merge_method: 'squash',
})
```

---

## INTENT DETECTION (server-side in /api/chat)

Detect PR-action intents from user message:

```typescript
const PR_INTENTS = [
  { pattern: /\bcek\s*pr\b/i,           action: 'PR_LIST' },
  { pattern: /\blist\s*pr\b/i,           action: 'PR_LIST' },
  { pattern: /\bcheck\s*pr\b/i,          action: 'PR_LIST' },
  { pattern: /\bmerge\s*pr\s*#?(\d+)/i,  action: 'PR_MERGE', group: 1 },
  { pattern: /\bclose\s*pr\s*#?(\d+)/i,  action: 'PR_CLOSE', group: 1 },
  { pattern: /\breview\s*pr\s*#?(\d+)/i, action: 'PR_REVIEW', group: 1 },
  { pattern: /\bpr\s*#?(\d+)\b/i,        action: 'PR_DETAIL', group: 1 },
]
```

When detected:
- Inject `<!-- PR_ACTION: {action}:{number} -->` marker into CMD response
- Client renders appropriate PRCard / PRListView
- CMD response prose explains the action taken or result

---

## VALIDATION TIER: MAJOR

Reasons:
- Adds GitHub merge/close write operations (direct repo impact)
- CMD can now merge PRs into `walkermind-os` main branch
- Touches PR review gate logic (AGENTS.md compliance required)
- Wrong merge = bad code in production repo

→ **WARP•SENTINEL audit required** before merge.

Sentinel focus areas:
- Gate logic correct (MAJOR tier blocked without SENTINEL)
- No bypass path to merge without checklist
- No merge without Validation Tier declared in PR body
- Branch format validated before merge
- PAT scope correct (pull_requests:write, not admin)
- No force-push or destructive operations possible

---

## DONE CRITERIA (8 items)

1. ✅ "cek pr" → CMD lists all WARP/* open PRs with tier + status in PRListCard
2. ✅ "merge pr #N" → CMD runs pre-merge checklist → executes merge → confirms "✅ PR #N merged"
3. ✅ MAJOR tier PR without SENTINEL verdict → CMD returns HOLD with reason, no merge executed
4. ✅ "close pr #N" → CMD posts close reason comment on GitHub → closes PR → confirms
5. ✅ Row inserted to `pr_actions` table with action + verdict + session_id
6. ✅ Pull Requests nav item in drawer shows PRListView with live data
7. ✅ Pre-merge drift check runs: Tier/Claim/Target/Not-in-Scope all declared, branch format WARP/*
8. ✅ No regression — Phase 1/1.5/2.5/3a/3b all intact

---

## PRE-REQUIREMENTS (Mr. Walker actions before dispatch)

### Step 1: Expand PAT scope (2 menit)

https://github.com/settings/personal-access-tokens
Edit `WARP CodX — Constitution Read`
Add: **Pull requests: Read and write**
Regenerate → update `GITHUB_PAT_CONSTITUTION` in Replit Secrets

### Step 2: Verify PAT can read PRs

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: token $GITHUB_PAT_CONSTITUTION" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/bayuewalker/walkermind-os/pulls
```

Expected: `HTTP 200`

### Step 3: Run SQL migration

```sql
create table if not exists public.pr_actions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete set null,
  pr_number int not null,
  action text not null check (action in ('merge', 'close', 'review', 'hold')),
  verdict text,
  reason text,
  performed_at timestamptz not null default now()
);

alter table public.pr_actions disable row level security;

create index if not exists idx_pr_actions_session
  on public.pr_actions (session_id, performed_at desc);
```

### Step 4: Verify SQL

Check `pr_actions` table visible in Supabase Table Editor.

---

## ROLLOUT PLAN

1. Mr. Walker: expand PAT + run SQL (Steps 1-3)
2. Dispatch spec to Replit Agent
3. Agent generates plan → Mr. Walker reviews → approve
4. Agent implements (~30-45 min)
5. Test 8 done criteria
6. WARP•SENTINEL audit (MAJOR tier — required)
7. Merge + ship

---

## TOKEN COST IMPACT

PR list fetch: ~2-5 GitHub API calls per "cek pr" (one-time, no LLM)
PR detail fetch: ~3-8 GitHub API calls per review
Merge/close: ~1-2 GitHub API calls per action

No additional LLM token cost beyond existing chat completion.

**New cost: ~0 additional tokens/day.** GitHub API is free for authenticated users.

---

## CONSTITUTION ALIGNMENT NOTES

Phase 3c is the first feature that makes WARP🔹CMD **actually execute** the
COMMANDER.md PR review flow — not just describe it. The following COMMANDER.md
behaviors must be implemented in code, not just in CMD persona:

1. **"DECISION: MERGE is not a merge"** → the `/api/prs/merge` call IS the merge
2. **Pre-review drift check** → server-side gate logic, not LLM judgement alone
3. **MAJOR tier = SENTINEL required** → hard block in merge endpoint
4. **Shortcut commands** → CMD detects `cek pr`, `merge pr`, `close pr` as
   operational triggers, not casual conversation
5. **Post-merge sync reminder** → after merge, CMD should note
   "Post-merge sync required: update PROJECT_STATE.md + ROADMAP.md + WORKTODO.md"

This ensures WARP CodX doesn't just "feel like" WARP🔹CMD —
it **is** the WARP🔹CMD execution surface for PR operations.

---

## OPEN QUESTIONS

1. Merge method: squash / merge / rebase?
   → **Squash** (default) — keeps main branch history clean per WARP convention.
   Override per PR if body specifies.

2. Should CMD auto-post comment on PR before merge (per PR COMMENT AUTO-POST RULE)?
   → **Yes** — if NEEDS-FIX found, CMD posts WARP•FORGE task comment to PR.
   If merging directly → no comment needed.

3. Should PRListView auto-refresh via Realtime?
   → **Yes** — subscribe to `pr_actions` table inserts. Refresh list when new action logged.

4. What if walkermind-os has no open WARP/* PRs?
   → CMD responds: "No open WARP/* PRs at this time."
   PRListView shows empty state.

5. Should CMD show bot review comments (Copilot, Gemini, etc.)?
   → **Yes** — display as collapsed "Bot reviews" section in PRCard expanded state.
   Auto-triage per COMMANDER.md bot review rules.
