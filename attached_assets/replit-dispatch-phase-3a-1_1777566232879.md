PHASE 3a — CONSTITUTION AUTO-FETCH

This is a MAJOR-tier feature. Branch: WARP/constitution-fetch.

Pre-requirements VERIFIED before dispatch:
- ✅ Repo migration done — app code now at bayuewalker/warp-codx (main branch, 733 objects)
- ✅ GITHUB_PAT_TOKEN set in Replit Secrets (push access to warp-codx)
- ✅ GITHUB_PAT_CONSTITUTION added to Replit Secrets (fine-grained, contents:read scoped to bayuewalker/walkermind-os)
- ✅ Supabase migration ran (3 new tables: constitution_cache, constitution_fetch_log, chat_warnings)

OBJECTIVE
Replace the hardcoded SYSTEM_PROMPT in /api/chat with a runtime fetch of WalkerMind OS constitution files from bayuewalker/walkermind-os repo. CMD persona, rules, and project state become single-source-of-truth at the repo, not in code.

Success: When Mr. Walker pushes update to AGENTS.md / COMMANDER.md / PROJECT_STATE.md → next CMD response (within 5 minutes) reflects the change without any code redeploy.

═══════════════════════════════════════════════
ARCHITECTURE (LOCKED — DO NOT REINTERPRET)
═══════════════════════════════════════════════

Q1. Fetch scope = TIERED
    Tier 1 (always): AGENTS.md, docs/COMMANDER.md, PROJECT_REGISTRY.md, {PROJECT_ROOT}/state/PROJECT_STATE.md
    Tier 2 (on-demand): triggered by keyword regex in user message, see spec for full mapping

Q2. Cache strategy = HYBRID (5 min TTL)
    Server-side cache in Supabase constitution_cache table
    Manual refresh via slash command: /refresh constitution

Q3. Fallback = LAST CACHED + SOFT WARNING
    GitHub failure → use cache → if no cache → HARDCODED_FALLBACK_PROMPT
    Show amber banner via chat_warnings table + Realtime broadcast

Q4. Size guards = MONITOR ONLY (no truncation Phase 3a)
    Log warning at >50KB per file, error at >100KB

Q5. PAT scope = contents:read ONLY
    Phase 3b will add issues:write, Phase 3c will add pull_requests:write

═══════════════════════════════════════════════
CRITICAL HARD CONSTRAINTS
═══════════════════════════════════════════════

- DO NOT change visual design, colors, layout, or component structure
- DO NOT touch Phase 1 / 1.5 / 2.5 working code unless adding Phase 3a integration points
- DO NOT add npm dependencies beyond @octokit/rest (which is the only new dep needed)
- DO NOT use Replit-proprietary APIs
- DO NOT skip observability (every fetch must log to constitution_fetch_log)
- DO NOT hardcode the PAT (env var process.env.GITHUB_PAT_CONSTITUTION only)

═══════════════════════════════════════════════
DELIVERABLES (per spec section "Deliverables")
═══════════════════════════════════════════════

Files to CREATE:
- src/lib/github.ts          (Octokit wrapper)
- src/lib/constitution.ts    (fetch + cache + assemble logic)
- src/app/api/constitution/refresh/route.ts  (manual refresh endpoint)
- src/components/ConstitutionStatus.tsx  (header status badge)
- src/components/WarningBanner.tsx        (chat warning banner)
- src/components/ConstitutionSettings.tsx (settings panel)
- docs/PHASE_3A_NOTES.md (operational notes)

Files to MODIFY:
- src/app/api/chat/route.ts  (use buildSystemPrompt instead of hardcoded SYSTEM_PROMPT)
- Add slash command parser supporting "/refresh constitution"

═══════════════════════════════════════════════
DONE CRITERIA — VERIFY ALL 8 BEFORE REPORTING DONE
═══════════════════════════════════════════════

1. ✅ Edit AGENTS.md in repo → wait 5 min → send message → CMD reflects change
2. ✅ Cache hit rate >80% in normal usage (verify via debug stats endpoint)
3. ✅ Revoke PAT temporarily → CMD continues with cached version + warning banner appears
4. ✅ /refresh constitution slash command bypasses cache, force-fetches all Tier 1
5. ✅ Header constitution status badge updates in real-time
6. ✅ Tier 2 fetch triggers correctly when message contains "phase" / "task" / "architecture" / etc.
7. ✅ No regression in Phase 1/1.5/2.5 functionality — all existing tests pass
8. ✅ PROJECT_STATE.md changes propagate within 5 minutes (manual edit → wait 5min → new chat reflects)

═══════════════════════════════════════════════
PROCESS
═══════════════════════════════════════════════

1. First: read the FULL SPEC below (everything between SPEC START and SPEC END markers)
2. Generate a complete plan covering all deliverables
3. WAIT for Mr. Walker to approve plan before any code changes
4. After approval: execute systematically, file by file
5. Report DONE only when all 8 done criteria are verified
6. After done: this is MAJOR tier → WARP•SENTINEL audit will follow before merge

═══════════════════════════════════════════════
SPEC START
═══════════════════════════════════════════════

[PASTE THE FULL CONTENT OF phase-3a-constitution-fetch-spec.md HERE]

═══════════════════════════════════════════════
SPEC END
═══════════════════════════════════════════════

Generate the implementation plan now. Do not start coding until plan is approved.
