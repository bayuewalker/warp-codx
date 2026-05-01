# Phase 3a — Constitution Auto-Fetch Operational Notes

## Overview

The WARP🔹CMD persona, brand rules, project registry, and per-project
operational state are no longer hardcoded. On every chat turn the API
assembles a fresh system prompt from files in
[`bayuewalker/walkermind-os`](https://github.com/bayuewalker/walkermind-os),
backed by a 5-minute Supabase cache.

Edits to constitution files become visible in the next chat reply within
≤5 minutes (cache TTL) with no rebuild and no redeploy.

## File tiers

### Tier 1 — always loaded

| Path | Purpose |
| ---- | ------- |
| `AGENTS.md` | Persona, brand rules, directive format |
| `COMMANDER.md` | Detailed CMD playbook (repo root) |
| `PROJECT_REGISTRY.md` | List of projects + `CURRENT FOCUS` marker |
| `{PROJECT_ROOT}/state/PROJECT_STATE.md` | Live state of the active project |

`PROJECT_ROOT` is parsed from the `## CURRENT FOCUS` section of
`PROJECT_REGISTRY.md`. The first line in that section matching
`projects/<vendor>/<repo>` (optionally inside backticks) is used. Falls
back to `projects/polymarket/polyquantbot` if parsing fails.

### Tier 2 — loaded only when the user message matches

| Path | Trigger keywords |
| ---- | ---------------- |
| `{ROOT}/state/ROADMAP.md`   | roadmap, phase, milestone, quarter, q1–q4 |
| `{ROOT}/state/WORKTODO.md`  | task, todo, backlog, worktodo, issue, ticket |
| `{ROOT}/state/CHANGELOG.md` | changelog, release, shipped, history, version |
| `docs/KNOWLEDGE_BASE.md`    | architecture, knowledge, design, spec, infra, infrastructure, api, convention(s), "how does", "why does" |

`KNOWLEDGE_BASE.md` lives at the repo root (not under any one project) —
it documents cross-project architecture, infra, and conventions.

Tier 2 misses are non-fatal — the file is silently skipped if it's
missing on the repo.

## Cache

- Table: `public.constitution_cache`
- Columns: `path` (PK), `content`, `sha`, `size_bytes`, `fetched_at`
- TTL: **5 minutes** from `fetched_at`
- Writes are upserts on `path` — last-write-wins is acceptable for the
  expected concurrency.

A separate table, `public.constitution_fetch_log`, captures one row per
fetch attempt with `status` ∈ {`hit_cache`, `miss_fetch`, `error_fallback`},
`duration_ms`, and `error_message` when applicable. The PAT is **never**
written into this table.

Size guards (logged only — no truncation):

- `console.warn` when a file exceeds **50 KB**
- `console.error` when a file exceeds **100 KB**

## Fallback chain

When fetching a single file, in order:

1. Cache hit within TTL → return cached
2. Otherwise → call GitHub via Octokit
3. On GitHub success → write cache, return fresh
4. On GitHub failure with stale cache → return last cached, status =
   `error_fallback`, surface a `warn`-level banner
5. On GitHub failure with **no cache** → throw

When `buildSystemPrompt` is called, **any** required Tier 1 file
(AGENTS.md, COMMANDER.md, PROJECT_REGISTRY.md, or
`{root}/state/PROJECT_STATE.md`) failing case 5 above causes the whole
build to throw. The chat handler then drops to
`SAFE_DEFAULT_SYSTEM_PROMPT` — a hardcoded copy of the
operator-encoding block + minimal CMD persona — and inserts an
`error`-level row into `chat_warnings`.

Stale-but-cached Tier 1 files (case 4) are not fatal: the prompt is
assembled normally and a `warn`-level row is inserted per affected
path, surfacing in the realtime banner.

The safe-default prompt **always** preserves the
`OPERATOR NAME ENCODING — STRICT` block from Task #6 so the
diamond/bullet behavior survives even in degraded mode.

## Slash command

In the composer, sending the literal text **`/refresh constitution`**
(case-insensitive, trimmed) does NOT dispatch a chat message. Instead it
calls `POST /api/constitution/refresh`, which force-refreshes all Tier 1
files (`forceRefresh: true`) and returns per-path status. The composer
shows a transient inline status line above the input zone with the
result.

## Status badge & bottom sheet

A small monochrome dot+text badge floats in the upper-right of the chat
column. States:

- **synced** — all Tier 1 files cached and fresh (<5 min)
- **refreshing** — manual refresh in flight (amber pulse)
- **stale** — at least one `error_fallback` in the last 5 min, but cache
  exists (amber)
- **offline** — no cache + GitHub unreachable (red)

Tapping the badge opens a bottom sheet listing each Tier 1 file's age,
size, and last fetch status with a **Refresh now** button.

## Realtime warning banner

A thin amber bar above the chat area subscribes to `chat_warnings` rows
filtered by the active session via Supabase Realtime. When a chat turn
results in any `error_fallback` (or drops to safe-default), a row is
inserted before streaming begins and the banner appears immediately. The
banner is dismissible per session, and auto-clears once the warning is
older than 5 minutes (i.e. by the next refresh cycle).

## Settings panel

Floating gear in the upper-right (next to the badge) opens a modal that
shows: repo, PAT scope, active project / `PROJECT_ROOT`, the four Tier 1
files with sizes and ages, cache totals, TTL, and the last manual
refresh timestamp. Three actions:

- **REFRESH ALL** — calls `POST /api/constitution/refresh` (always
  available; powers the user-facing slash command too).
- **CLEAR CACHE** — calls `POST /api/constitution/clear` (deletes all
  rows from `constitution_cache`). Admin-gated in production.
- **TEST PAT** — calls `GET /api/constitution/test-pat`, which performs
  an Octokit `repos.get` and reports `ok` / `unauthorized` / `other`.
  Admin-gated in production.

### Admin gate

`/api/constitution/clear` and `/api/constitution/test-pat` are sensitive —
clear is destructive and test-pat is a credential-validity probe — so in
production they require **one** of:

1. `DEBUG_CONSTITUTION_STATS=1` set in the environment, OR
2. The request to carry `x-warp-admin-token` matching the `WARP_ADMIN_TOKEN`
   env var.

Outside production both endpoints are open. `/api/constitution/refresh`
is intentionally **not** gated because the user-facing slash command
(`/refresh constitution`) hits it from the browser without credentials.

## Debug stats endpoint

`GET /api/debug/constitution-stats` returns hit/miss/error counts and
average duration per path over the last 24 hours, plus an overall hit
rate. This is the verification mechanism for the **>80% cache hit rate**
target in normal interactive usage.

The endpoint is gated:

- Always enabled when `NODE_ENV !== "production"`
- In production, set `DEBUG_CONSTITUTION_STATS=1` to enable

## PAT rotation procedure

1. In GitHub → Developer Settings → Personal access tokens → Fine-grained
   tokens, generate a new token. Scope: **`contents:read` only**, and
   limit the resource to the `bayuewalker/walkermind-os` repository.
2. In Replit → Secrets, update `GITHUB_PAT_CONSTITUTION` with the new
   token value. (Do not commit it anywhere.)
3. Restart the `Start application` workflow so the running Node process
   picks up the new env var.
4. Open the Settings panel → click **TEST PAT** to confirm it returns
   `ok`.
5. Click **REFRESH ALL** so the cache is repopulated against the new
   token before the next chat turn.
6. Revoke the old token in GitHub.

## Open behavior — `CURRENT FOCUS` switching mid-session

`PROJECT_ROOT` is resolved per chat call (it is read from
`PROJECT_REGISTRY.md` every time `buildSystemPrompt` runs). If Mr. Walker
edits `CURRENT FOCUS` on the repo mid-session and waits ≤5 min for the
cache TTL to elapse, the **next** message in the same session will load
the new project's `PROJECT_STATE.md` and Tier 2 files.

The previous turn's history (already-streamed messages) is unchanged —
the model simply receives different operational context for subsequent
turns. This matches the Phase 3a recommendation in the spec.
