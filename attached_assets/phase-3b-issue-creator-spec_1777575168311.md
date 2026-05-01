# PHASE 3b — Issue Creator from Chat

> **Spec version:** 1.0
> **Date:** 2026-04-30
> **Branch target:** `WARP/issue-creator`
> **Validation tier:** STANDARD
> **Dispatch to:** Replit Agent

---

## OBJECTIVE

Allow Mr. Walker to create GitHub issues in `bayuewalker/walkermind-os` directly from WARP CodX chat. CMD detects issue-creation intent from directive, formats it using the `# WARP•FORGE TASK:` template from COMMANDER.md, previews it inline, and creates the issue on GitHub via Octokit with one tap.

**Success metric:** Mr. Walker types a directive like "buat issue untuk refactor risk module" → CMD generates structured FORGE TASK → inline card shows preview → tap "Create Issue" → issue appears at `github.com/bayuewalker/walkermind-os/issues`.

---

## PAT SCOPE EXPANSION

Phase 3a PAT (`GITHUB_PAT_CONSTITUTION`) is `contents:read` only — cannot create issues.

**New PAT required for Phase 3b:**
- Name: `WARP CodX — Issue Creator`
- Repo: `bayuewalker/walkermind-os` only
- Permissions:
  - `Contents: Read-only` (keep for constitution)
  - `Issues: Read and write` ← NEW

**Options:**

**Option A (recommended):** Edit existing `GITHUB_PAT_CONSTITUTION` → add `Issues: Read and write` → regenerate → update Replit Secrets.

**Option B:** Create separate `GITHUB_PAT_ISSUES` with `issues:write` only.

**Gw recommend Option A** — satu PAT untuk read constitution + write issues ke `walkermind-os`. Simpler, less secrets to manage. Still scoped to walkermind-os only (least privilege preserved).

---

## ARCHITECTURE

### Issue creation flow

```
Mr. Walker directive
       ↓
CMD detects issue intent
(keyword: "buat issue", "create issue", "tambah issue", "open issue")
       ↓
CMD generates FORGE TASK structured block
(using template from COMMANDER.md — fetched via constitution layer)
       ↓
Render inline IssueCard in chat
(preview: title, body, labels, assignee)
       ↓
Mr. Walker taps "Create Issue"
       ↓
POST /api/issues/create
       ↓
Octokit issues.create → walkermind-os
       ↓
Card updates: "✓ Issue #127 created" with GitHub link
```

### Issue format (from COMMANDER.md template)

```
Title:  [short task name]
Body:
  # WARP•FORGE TASK: [short task name]
  ============
  Repo      : https://github.com/bayuewalker/walkermind-os
  Branch    : WARP/{feature-slug}
  Env       : dev

  OBJECTIVE:
  [extracted from CMD directive]

  SCOPE:
  - [inferred from directive]

  VALIDATION:
  Validation Tier   : MINOR / STANDARD / MAJOR
  Claim Level       : NARROW INTEGRATION
  Validation Target : [scope]
  Not in Scope      : [exclusions]

  DELIVERABLES:
  1. [code / report / state update]

  DONE CRITERIA:
  - [ ] Forge report at correct path
  - [ ] PROJECT_STATE.md updated
  - [ ] PR opened from declared branch

  NEXT GATE:
  - WARP🔹CMD review

Labels: ["forge-task"] (auto-applied)
Assignees: [] (none by default — Mr. Walker assigns manually)
```

---

## SCOPE

### Files to CREATE

- `src/lib/github-issues.ts` — Octokit wrapper for issue operations
- `src/app/api/issues/create/route.ts` — POST endpoint to create issue
- `src/app/api/issues/list/route.ts` — GET endpoint to list WARP/* issues
- `src/components/IssueCard.tsx` — inline preview card in chat
- `src/components/IssueCreator.tsx` — form for editing before create (optional — if CMD output needs adjustment)

### Files to MODIFY

- `src/app/api/chat/route.ts` — detect issue-creation intent, inject IssueCard into response
- `src/lib/constitution.ts` — no change (constitution fetch handles COMMANDER.md already)

### Supabase (new table)

```sql
create table if not exists public.issues_created (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete set null,
  github_issue_number int not null,
  github_issue_url text not null,
  title text not null,
  branch_slug text,
  validation_tier text check (validation_tier in ('MINOR', 'STANDARD', 'MAJOR')),
  created_at timestamptz not null default now()
);

alter table public.issues_created disable row level security;

create index idx_issues_session on public.issues_created (session_id, created_at);
```

### Out of scope

- Issue editing after creation (Phase 3b = create only)
- Issue comments (Phase 3c)
- PR creation (Phase 3c)
- Issue list view in drawer (nav item exists from Design Decisions v1.0 — will be wired in Phase 3b UI)
- Issue assignment to specific agents (manual for now)
- Webhook listener for issue updates (Phase 3c)

---

## ISSUE CARD UI (inline in chat)

When CMD detects issue intent and generates FORGE TASK, render:

```
┌─────────────────────────────────────────────────┐
│ 🔖  NEW ISSUE DRAFT               [WARP•FORGE]  │
│─────────────────────────────────────────────────│
│ Title:  Add wallet validation guard              │
│ Branch: WARP/wallet-guard                        │
│ Tier:   STANDARD                                 │
│                                                  │
│ OBJECTIVE:                                       │
│ Add capital safety guard that validates wallet   │
│ balance before executing trade...                │
│                                                  │
│ [EDIT]          [DISCARD]    [CREATE ISSUE ▶]   │
└─────────────────────────────────────────────────┘
```

**After create:**
```
┌─────────────────────────────────────────────────┐
│ ✓  ISSUE #127 CREATED              [WARP•FORGE] │
│─────────────────────────────────────────────────│
│ Add wallet validation guard                      │
│ github.com/bayuewalker/walkermind-os/issues/127  │
│                                                  │
│ [OPEN IN GITHUB ↗]                              │
└─────────────────────────────────────────────────┘
```

**Visual style:** match existing card patterns from mockup r4 (dark bg-elev-1, border-soft, teal left-border for FORGE tag, rounded-md).

---

## DETECTION LOGIC

CMD detects issue creation intent from:

**Explicit triggers (Bahasa Indonesia + English):**
- `buat issue`, `create issue`, `tambah issue`, `open issue`
- `bikin task untuk`, `dispatch ke forge`, `kasih ke forge`
- `forge task:`, `# WARP•FORGE TASK:`

**Implicit (CMD decides):**
- Directive clearly describes build work scoped to a specific feature
- CMD confidence level high enough to generate FORGE TASK

**When detected:**
- CMD generates FORGE TASK structured block
- Append `<!-- ISSUE_DRAFT: true -->` marker at end of response
- Client-side: detect marker → render IssueCard component

**When NOT detected:**
- Normal conversation → no IssueCard
- Ambiguous → CMD asks: "Mau gw buatkan GitHub issue untuk ini?"

---

## API ENDPOINTS

### POST /api/issues/create

```typescript
// Request
{
  sessionId: string,
  title: string,
  body: string,           // full FORGE TASK formatted body
  branchSlug: string,     // e.g. "wallet-guard"
  validationTier: 'MINOR' | 'STANDARD' | 'MAJOR',
  labels: string[]        // default: ['forge-task']
}

// Response
{
  issueNumber: number,
  issueUrl: string,
  title: string
}
```

Uses `GITHUB_PAT_CONSTITUTION` (after scope expansion to include issues:write).

### GET /api/issues/list

```typescript
// Response
{
  issues: Array<{
    number: number,
    title: string,
    state: 'open' | 'closed',
    url: string,
    labels: string[],
    createdAt: string,
    branchSlug?: string   // extracted from title or body
  }>
}
```

---

## DONE CRITERIA (8 items)

1. ✅ Directive "buat issue untuk [X]" → CMD generates FORGE TASK block → IssueCard renders inline
2. ✅ Tap "Create Issue" → issue appears at `github.com/bayuewalker/walkermind-os/issues` with correct title + body
3. ✅ Issue body matches `# WARP•FORGE TASK:` template format exactly (no backtick nesting)
4. ✅ Card updates to "✓ Issue #N created" with GitHub link after create
5. ✅ Row inserted to `issues_created` Supabase table with correct session_id + issue_number
6. ✅ Issues list view in drawer ("Issues" nav item) shows created issues with status
7. ✅ No regression in Phase 1/1.5/2.5/3a — constitution fetch, chat streaming, sessions all intact
8. ✅ "EDIT" button on IssueCard allows adjusting title/branch/tier before create

---

## VALIDATION TIER: STANDARD

Reasons:
- Adds new external write operation (GitHub issues.create)
- New Supabase table
- Modifies chat API route (additive — intent detection)
- No capital/risk/execution system impact

→ WARP🔹CMD review sufficient, no SENTINEL required.

---

## PRE-REQUIREMENTS (Mr. Walker actions before dispatch)

**Step 1: Expand PAT scope (2 menit)**
- https://github.com/settings/personal-access-tokens
- Edit `WARP CodX — Constitution Read` PAT
- Add permission: `Issues: Read and write`
- Regenerate token → copy new value
- Replit Secrets → update `GITHUB_PAT_CONSTITUTION` with new value

**Step 2: Run SQL migration**

```sql
create table if not exists public.issues_created (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete set null,
  github_issue_number int not null,
  github_issue_url text not null,
  title text not null,
  branch_slug text,
  validation_tier text check (validation_tier in ('MINOR', 'STANDARD', 'MAJOR')),
  created_at timestamptz not null default now()
);

alter table public.issues_created disable row level security;

create index if not exists idx_issues_session
  on public.issues_created (session_id, created_at);
```

**Step 3: Verify PAT can create issues**

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: token $GITHUB_PAT_CONSTITUTION" \
  -H "Accept: application/vnd.github+json" \
  -X POST \
  https://api.github.com/repos/bayuewalker/walkermind-os/issues \
  -d '{"title":"[TEST] Phase 3b PAT verify — delete me","body":"Test issue","labels":["test"]}'
```

Expected: `HTTP 201`. Delete the test issue after verify.

---

## ROLLOUT

1. Mr. Walker expand PAT + run SQL (Steps 1-3 above)
2. Dispatch spec to Replit Agent
3. Agent generates plan → Mr. Walker reviews → approve
4. Agent implements (~30 min)
5. Test 8 done criteria
6. WARP🔹CMD review (STANDARD tier — no SENTINEL)
7. Merge + ship

---

## TOKEN COST IMPACT

Issue creation is a one-time API call per directive — minimal cost.
Constitution fetch cost unchanged (Phase 3a handles this).
No additional LLM calls beyond existing chat completion.

**New cost:** ~0 additional tokens/day (issues.create is GitHub API, not LLM).

---

## OPEN QUESTIONS

1. Should IssueCard be dismissible if Mr. Walker decides not to create?
   → **Yes** — "DISCARD" button on card, removes card from chat stream visually.

2. Should CMD auto-infer branch slug from directive, or always ask?
   → **Auto-infer** from directive context. Show in card for confirmation before create. Mr. Walker edits if wrong.

3. Should issues_created table be realtime-enabled?
   → **Yes** — enables Issues view in drawer to update live when issue created from any session.

4. What labels to auto-apply?
   → Default: `["forge-task"]`. STANDARD tier adds `["forge-task", "standard"]`. MAJOR adds `["forge-task", "major"]`.

---

## RELATIONSHIP TO DESIGN DECISIONS v1.0

Phase 3b wires the **Issues nav item** in drawer (already exists in mockup r4 and Design Decisions v1.0 Section 3). After Phase 3b:

- Issues view = list of `issues_created` rows + GitHub API issues list (filtered by `forge-task` label)
- Issue rows show: number, title, status (open/closed), validation tier pill, created time

This is the first time the drawer Issues nav becomes functional (previously placeholder).
