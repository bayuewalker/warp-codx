# WARP•SENTINEL TASK: Phase 3a Constitution Auto-Fetch Audit

**Validation tier:** MAJOR
**Branch:** WARP/constitution-fetch
**Requested by:** WARP🔹CMD
**Trigger:** Phase 3a functional verification passed — all 8 done criteria confirmed by Mr. Walker

---

## OBJECTIVE

Perform full MAJOR-tier validation audit of Phase 3a (constitution auto-fetch) before merge to main. Validate security, correctness, fallback integrity, and no regression.

---

## SCOPE

Audit ONLY code introduced or modified in Phase 3a:

**New files:**
- src/lib/github.ts
- src/lib/constitution.ts
- src/app/api/constitution/refresh/route.ts
- src/components/ConstitutionStatus.tsx (if exists)
- src/components/WarningBanner.tsx (if exists)
- src/components/ConstitutionSettings.tsx (if exists)
- docs/PHASE_3A_NOTES.md

**Modified files:**
- src/app/api/chat/route.ts (system prompt source change)
- src/components/ChatInput.tsx (slash command parser)
- src/components/AppShell.tsx (new component mounting)
- package.json (only @octokit/rest should be new)

**Database:** constitution_cache, constitution_fetch_log, chat_warnings (read-only audit — do NOT modify schema)

---

## AUDIT CHECKLIST

### SECURITY (Critical — any failure = BLOCK merge)

- [ ] S1: `GITHUB_PAT_CONSTITUTION` is NEVER hardcoded anywhere in src/. Search for any literal `github_pat_` or `ghp_` strings in code.
- [ ] S2: PAT value is never written to constitution_fetch_log, console logs, or any client-visible response. Check error handling paths specifically — Octokit errors may include auth headers.
- [ ] S3: `/api/constitution/refresh` endpoint has no authentication bypass — verify it's server-side only and not callable from client without proper context.
- [ ] S4: No secrets exposed in `/api/debug/constitution-stats` response.
- [ ] S5: Octokit is instantiated at request time (inside function), NOT at module import level. Module-level instantiation with env vars can cause PAT to be undefined.

### FALLBACK CHAIN (Critical — any failure = BLOCK merge)

- [ ] F1: Fallback chain is correct: GitHub API → cache → HARDCODED_FALLBACK_PROMPT. No path skips a level.
- [ ] F2: HARDCODED_FALLBACK_PROMPT still contains the OPERATOR NAME ENCODING — STRICT block (diamond/bullet rendering rules from Task #6). Verify this block exists verbatim in the fallback.
- [ ] F3: When fallback is used, `chat_warnings` row is inserted with level='warn' before stream begins.
- [ ] F4: No silent failures — every catch block either falls back correctly or re-throws with logging.
- [ ] F5: Cache TTL of exactly 5 minutes is enforced. Check the comparison logic — off-by-one or timezone issues can break this.

### CONSTITUTION FETCH CORRECTNESS

- [ ] C1: Tier 1 paths are exactly: AGENTS.md, docs/COMMANDER.md, PROJECT_REGISTRY.md, {PROJECT_ROOT}/state/PROJECT_STATE.md. No more, no less.
- [ ] C2: PROJECT_ROOT is resolved from PROJECT_REGISTRY.md CURRENT FOCUS section, with hardcoded fallback `projects/polymarket/polyquantbot` if parsing fails.
- [ ] C3: Tier 2 keyword triggers are regex-based and match spec: roadmap/worktodo/changelog/knowledge_base triggers. Verify no over-broad patterns that trigger on common words.
- [ ] C4: buildSystemPrompt assembles sections in correct order: PERSONA (COMMANDER.md) → GLOBAL RULES (AGENTS.md) → ACTIVE PROJECTS (REGISTRY) → CURRENT OPERATIONAL TRUTH (PROJECT_STATE) → ADDITIONAL CONTEXT (Tier 2 if any).
- [ ] C5: /refresh constitution (case-insensitive, trimmed) in composer routes to refresh endpoint, not to CMD.

### CACHE INTEGRITY

- [ ] CA1: Supabase upsert is used for cache writes (not insert) — prevents unique constraint violations on concurrent requests.
- [ ] CA2: constitution_fetch_log correctly records hit_cache, miss_fetch, error_fallback for every code path. No path exits without logging.
- [ ] CA3: Size monitoring logs: console.warn at >50KB, console.error at >100KB. Verify these exist.
- [ ] CA4: Cache clear via settings panel deletes only constitution_cache rows, nothing else.

### REGRESSION (Phase 1/1.5/2.5 must be untouched)

- [ ] R1: src/app/api/chat/route.ts — ONLY the system prompt source line changed. Streaming logic, history loading, message persistence, session handling all byte-identical to pre-Phase 3a.
- [ ] R2: src/components/ChatInput.tsx — ONLY the slash command parser branch added. All existing composer behavior unchanged.
- [ ] R3: No new npm dependencies beyond @octokit/rest in package.json.
- [ ] R4: All existing Supabase tables (sessions, messages) untouched — no schema changes.
- [ ] R5: Visual design unchanged — status strip, header, session bar, chat area, input zone all identical to v2 mockup.

### OBSERVABILITY

- [ ] O1: /api/debug/constitution-stats endpoint exists and returns cache hit/miss/error counts per path for last 24 hours.
- [ ] O2: docs/PHASE_3A_NOTES.md exists and covers: PAT rotation, cache TTL, fallback chain, slash command, debug endpoint, mid-session project switching behavior.

---

## SENTINEL REPORT FORMAT

Report must be delivered at: `projects/polymarket/polyquantbot/reports/sentinel/phase-3a-constitution-fetch.md`

Wait — correction: Phase 3a is WARP CodX app code, not CrusaderBot. Deliver report at:
`docs/reports/sentinel/phase-3a-constitution-fetch.md` (create docs/reports/sentinel/ if not exists)

Report format:
```
WARP•SENTINEL AUDIT REPORT
Branch: WARP/constitution-fetch
Tier: MAJOR
Date: [date]
Score: [X]/100
Critical findings: [N]

[PASS] S1: No hardcoded PAT
[PASS/FAIL] S2: ...
... (all checklist items)

VERDICT: APPROVED / BLOCKED
If BLOCKED: list exact items that must be fixed before merge.
```

---

## DONE CRITERIA FOR SENTINEL

- All Security checks (S1-S5): PASS
- All Fallback Chain checks (F1-F5): PASS
- All Regression checks (R1-R5): PASS
- Score >= 85/100
- Zero Critical findings
- Report delivered at correct path

If any Security or Fallback check fails → BLOCKED, do not approve merge.
If Regression checks fail → BLOCKED.
If only minor Observability issues → can approve with deferred notes.

---

## NEXT GATE

Return verdict to WARP🔹CMD. If APPROVED → Mr. Walker merges WARP/constitution-fetch → main.
If BLOCKED → WARP🔹CMD consolidates fix task for WARP•FORGE, re-run required.
