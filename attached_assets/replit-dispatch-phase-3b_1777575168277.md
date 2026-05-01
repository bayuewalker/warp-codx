PHASE 3b — ISSUE CREATOR FROM CHAT

This is a STANDARD-tier feature. Branch: WARP/issue-creator.

Pre-requirements VERIFIED:
- ✅ GITHUB_PAT_CONSTITUTION expanded to include Issues: Read and write
- ✅ PAT verified via curl — HTTP 201 (issue creation works)
- ✅ Supabase table issues_created created and confirmed in Table Editor
- ✅ Phase 3a constitution fetch working (CMD reads COMMANDER.md live)

OBJECTIVE
Allow Mr. Walker to create GitHub issues in bayuewalker/walkermind-os directly
from WARP CodX chat. CMD detects issue-creation intent, generates a structured
WARP•FORGE TASK block, shows an inline IssueCard preview, and creates the issue
on GitHub with one tap.

Success: Mr. Walker types "buat issue untuk refactor risk module" → CMD generates
FORGE TASK → IssueCard renders inline → tap "Create Issue" → issue appears at
github.com/bayuewalker/walkermind-os/issues

═══════════════════════════════════════════════
ARCHITECTURE
═══════════════════════════════════════════════

FLOW:
1. Mr. Walker sends directive (e.g. "buat issue untuk X")
2. CMD detects issue-creation intent via keywords
3. CMD generates FORGE TASK structured block (using template from COMMANDER.md)
4. CMD appends <!-- ISSUE_DRAFT: true --> marker to response
5. Client detects marker → renders IssueCard component inline
6. Mr. Walker taps "Create Issue"
7. POST /api/issues/create → Octokit issues.create → walkermind-os
8. Card updates: "✓ Issue #N created" + GitHub link

INTENT DETECTION KEYWORDS (Bahasa Indonesia + English):
- "buat issue", "create issue", "tambah issue", "open issue"
- "bikin task untuk", "dispatch ke forge", "kasih ke forge"
- "forge task:", "# WARP•FORGE TASK:"

ISSUE FORMAT (body must match COMMANDER.md template exactly):
# WARP•FORGE TASK: [short task name]
============
Repo      : https://github.com/bayuewalker/walkermind-os
Branch    : WARP/{feature-slug}
Env       : dev

OBJECTIVE:
[extracted from directive]

SCOPE:
- [inferred]

VALIDATION:
Validation Tier   : MINOR / STANDARD / MAJOR
Claim Level       : NARROW INTEGRATION
Validation Target : [scope]
Not in Scope      : [exclusions]

DELIVERABLES:
1. [deliverable]

DONE CRITERIA:
- [ ] Forge report at correct path
- [ ] PROJECT_STATE.md updated
- [ ] PR opened from declared branch

NEXT GATE:
- WARP🔹CMD review

═══════════════════════════════════════════════
DELIVERABLES
═══════════════════════════════════════════════

Files to CREATE:
- src/lib/github-issues.ts          (Octokit wrapper for issues.create + issues.list)
- src/app/api/issues/create/route.ts (POST endpoint)
- src/app/api/issues/list/route.ts   (GET endpoint — list WARP/* issues)
- src/components/IssueCard.tsx       (inline preview card in chat)

Files to MODIFY:
- src/app/api/chat/route.ts          (append <!-- ISSUE_DRAFT: true --> when intent detected)
- src/components/ChatArea.tsx        (detect marker → render IssueCard)
- src/components/Sidebar.tsx         (wire Issues nav item to show issues_created list)

═══════════════════════════════════════════════
ISSUE CARD UI SPEC
═══════════════════════════════════════════════

DRAFT STATE:
┌─────────────────────────────────────────────────┐
│ 🔖  NEW ISSUE DRAFT               [WARP•FORGE]  │
│─────────────────────────────────────────────────│
│ Title:  [task name]                              │
│ Branch: WARP/[slug]                              │
│ Tier:   MINOR / STANDARD / MAJOR                 │
│                                                  │
│ OBJECTIVE:                                       │
│ [first 2 lines of objective, truncated]          │
│                                                  │
│ [EDIT]    [DISCARD]    [CREATE ISSUE ▶]          │
└─────────────────────────────────────────────────┘

CREATED STATE:
┌─────────────────────────────────────────────────┐
│ ✓  ISSUE #N CREATED               [WARP•FORGE]  │
│─────────────────────────────────────────────────│
│ [issue title]                                    │
│ github.com/bayuewalker/walkermind-os/issues/N    │
│                                                  │
│ [OPEN IN GITHUB ↗]                              │
└─────────────────────────────────────────────────┘

VISUAL STYLE:
- Match existing card patterns (bg-elev-1, border-soft)
- Teal left-border (2px) for FORGE tag — same as agent-pill forge color
- rounded-md (10px radius)
- Font: Inter for labels, JetBrains Mono for code/paths
- DO NOT change any existing visual design

═══════════════════════════════════════════════
API SPEC
═══════════════════════════════════════════════

POST /api/issues/create
Request: { sessionId, title, body, branchSlug, validationTier, labels }
Response: { issueNumber, issueUrl, title }
After create: insert row to issues_created table

GET /api/issues/list
Response: { issues: [{ number, title, state, url, labels, createdAt }] }
Filter: issues with label "forge-task"

Labels auto-applied:
- All issues: ["forge-task"]
- STANDARD tier: ["forge-task", "standard"]
- MAJOR tier: ["forge-task", "major"]

═══════════════════════════════════════════════
DONE CRITERIA — VERIFY ALL 8 BEFORE REPORTING DONE
═══════════════════════════════════════════════

1. ✅ "buat issue untuk [X]" → CMD generates FORGE TASK → IssueCard renders inline
2. ✅ Tap "Create Issue" → issue appears at github.com/bayuewalker/walkermind-os/issues
3. ✅ Issue body matches # WARP•FORGE TASK: template format (no backtick nesting inside body)
4. ✅ Card updates to "✓ Issue #N created" with GitHub link after create
5. ✅ Row inserted to issues_created Supabase table with session_id + issue_number
6. ✅ Issues nav item in drawer shows list of created issues
7. ✅ No regression — constitution fetch, chat streaming, sessions, design all intact
8. ✅ EDIT button allows adjusting title/branch/tier before create

═══════════════════════════════════════════════
HARD CONSTRAINTS
═══════════════════════════════════════════════

- DO NOT change visual design, colors, layout, typography
- DO NOT add npm dependencies (Octokit already installed from Phase 3a)
- DO NOT use GITHUB_PAT_TOKEN for issue creation — use GITHUB_PAT_CONSTITUTION
- DO NOT write PAT value to any log or response
- DO NOT touch Phase 3a constitution fetch logic
- DO NOT modify sessions/messages/constitution tables
- issues_created table already exists — do NOT re-run CREATE TABLE
- Supabase schema: issues_created already created — query read-only to verify

═══════════════════════════════════════════════
PROCESS
═══════════════════════════════════════════════

1. Read full spec below (between SPEC START and SPEC END)
2. Generate complete implementation plan
3. WAIT for Mr. Walker approval before any code changes
4. Execute file by file
5. Verify all 8 done criteria before reporting done

═══════════════════════════════════════════════
SPEC START
═══════════════════════════════════════════════

[PASTE FULL CONTENT OF phase-3b-issue-creator-spec.md HERE]

═══════════════════════════════════════════════
SPEC END
═══════════════════════════════════════════════

Generate implementation plan now. Do not start coding until approved.
