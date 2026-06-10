# WARP CodX

## Overview
WARP CodX is a mobile-first command interface designed to orchestrate AI agents within the WalkerMind OS. It functions as a dispatcher persona, enabling users to interact with AI for various tasks such as building, hotfixing (FORGE), reviewing (SENTINEL), and reporting (ECHO). The project aims to streamline AI agent management through a conversational interface, enhancing productivity and enabling complex operations via natural language commands. Its core capabilities include dynamic persona management via external configuration, structured issue creation, and pull request management with automated gate checks and audit trails.

## User Preferences
Not specified.

## System Architecture

### Core Technologies
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS (dark mode default)
- **Database & Realtime**: Supabase
- **AI**: OpenAI SDK via OpenRouter gateway (default model: `openai/gpt-4o`)
- **Node.js**: Version 24 (compatible with Node.js ≥ 18.17)

### Project Structure
- `src/app/`: App Router routes and layout, including API handlers for sessions, messages, and chat.
- `src/components/`: Client-side components for UI elements like sidebar, chat interface, and input.
- `src/lib/`: Houses Supabase clients, OpenAI helpers, hooks, and utility functions, including dynamic system prompt assembly.

### UI/UX Decisions
- **Chat Interface**: Features a composer with a textarea and toolbar, a send button that morphs into a stop button during streaming, and a footer LED for model health status.
- **Message Content**: Rich typography with specific font settings, inline code styling, list formatting, and blockquote styling.
- **Dynamic UI Elements**:
    - **ThinkingIndicator**: Displays pulsing dots during AI processing.
    - **CollapsibleSection**: Groups rich-block content (actions, diffs, todos) for better readability.
    - **TaskCompleteCard**: Renders structured cards for various task completion events (e.g., issue created, PR merged).

### Key Features and Implementations
- **Paginated Sessions Sidebar (Task #37)**: `GET /api/sessions` is cursor-paginated (default 10, max 50) using a `before=<created_at>` cursor; the response shape is `{ sessions, hasMore, nextCursor }`. The sidebar fetches the first page on mount and asks the server for the next page when the user taps "Show more". `GET /api/sessions/[id]` returns a single session so `ChatArea` can refresh just the active row's `updated_at` after a stream instead of pulling the whole list.
- **Auto-load Older Sessions on Scroll (Task #40)**: The Sidebar renders an invisible `aria-hidden` sentinel just below the last `SessionRow` and watches it with an `IntersectionObserver`. When it scrolls into view (200px rootMargin), the same `onLoadMoreSessions` callback is invoked. The "Show more" button stays mounted as a keyboard-accessible fallback and visible loading indicator. The observer is torn down whenever a fetch is in flight (`loadingMoreSessions`) or there are no more pages (`hasMoreSessions=false`), and the parent's existing in-flight guard from Task #37 dedupes any rapid re-intersections.
- **Workspace system prompt (custom instructions · memory · skills)**: The chat system prompt is composed at runtime in `src/lib/system-prompt.ts` from a neutral base identity plus three operator-owned blocks stored in Supabase:
    - **Custom instructions** (`app_settings`) — always-on guidance, edited in Settings → Instructions.
    - **Memory** (`memories`) — durable facts. `manual` entries are added by the operator; `auto` entries are extracted from chat by a cheap model and land as `pending` for review before going `active`. Only `active` entries are injected.
    - **Skills** (`skills`) — installed SKILL.md modules. Every enabled skill is advertised by name+description each turn; the full body is injected only when the user's message matches the skill's name or triggers.
    All three blocks degrade independently — a missing table or failure never breaks a chat turn. (This replaced the earlier GitHub "constitution" auto-fetch as the prompt source; the constitution routes/lib remain but are no longer wired into `/api/chat`.)
- **Issue Creation from Chat**: Detects user intent to create issues, generates a structured sidecar marker, and renders an inline `IssueCard`. A dedicated "Issues" navigation item allows viewing and managing issues.
- **Pull Request Management**: Detects PR-related intent, renders `PRListCard` or `PRCard`, and allows actions like merging or closing PRs. Includes server-side gate evaluation for merge operations and real-time updates for PR lists.
- **CI Status Integration**: Integrates with GitHub Checks API to fetch CI statuses for pull requests, blocking merges if CI checks fail or are pending.
- **Error Handling and Audit Trails**: Comprehensive error handling for API interactions, including specific HTTP status code mappings for GitHub API errors. Audit tables (`public.issues_created`, `public.pr_actions`) track key actions.
- **Portability**: The application is designed as a vanilla Next.js 14 app with no Replit-specific code, ensuring deployability to various Node.js hosting environments.

### Task #2 — Auth + RLS prep (in progress)
The full plan locks the chat tables (`sessions`, `messages`, `chat_warnings`, `session_constitution_state`) so each row is only visible/writable by its owner via Supabase Auth + row-level security. The mobile workspace UI is currently hiding the task-approval button, so the safe non-auth pieces have been landed directly:

- **Wipe** — `sessions`, `messages`, `chat_warnings`, `session_constitution_state` were emptied in the dev Supabase project (38 sessions / 114 messages / 4 warnings → 0). The operator authorized this; no migration of historical rows.
- **Migration SQL** — `db/migrations/0001-auth-rls.sql` adds a NOT NULL `user_id uuid references auth.users` column to `sessions`, re-enables RLS on the four chat tables, and installs `auth.uid()`-keyed policies. It is **not yet applied** — apply it from the Supabase SQL editor only after Supabase Auth is enabled and the app-side auth wiring ships, otherwise the running app's anon-key Realtime subscriptions will silently start returning zero rows.
- **Per-request client** — `getRequestSupabase(authHeader)` in `src/lib/supabase.ts` is the new helper that binds queries to the caller's bearer token so RLS applies. Additive only; existing routes still use `getServerSupabase()` and behavior is unchanged.

Still deferred (the auth-dependent half): sign-in UI (email magic-link), 401 gating in `/api/{sessions,messages,chat}` routes, browser Realtime client switched to authenticated mode, sign-out control, and the cross-user isolation tests. Those will land once the operator can approve task agents from this workspace.

## External Dependencies

- **Supabase**: Used for database operations, real-time functionalities, and caching.
    - `@supabase/supabase-js`
- **LLM provider (OpenAI-compatible)**: All AI completions go through one OpenAI-compatible endpoint; the provider is selected at runtime via `LLM_PROVIDER` (`openrouter` | `openai` | `blackbox`). Resolution lives in `src/lib/provider.ts`; per-provider model defaults (overridable with `LLM_MODEL`) live in `src/lib/models.ts`.
    - OpenAI SDK
    - `LLM_PROVIDER`, `LLM_MODEL` (optional)
    - `OPENROUTER_API_KEY` (openrouter) · `OPENAI_API_KEY` (openai) · `BLACKBOX_API_KEY` (blackbox)
- **GitHub API**: Utilized for fetching constitution files, creating issues, listing, and managing pull requests. Requires a Personal Access Token (`GITHUB_PAT_CONSTITUTION`).
    - Octokit (internal wrapper `src/lib/github-issues.ts`, `src/lib/github-prs.ts`)
- **Highlight.js**: Used for syntax highlighting in code blocks within chat messages.
    - `highlight.js/styles/github-dark.css`
- **web-push**: Server-side Web Push (VAPID) delivery for Phase 4 push notifications. The browser opts in via `PushNotificationToggle` in Constitution Settings, the SW lives at `public/sw.js`, the helper at `src/lib/push-server.ts`, and routes at `/api/push/{subscribe,unsubscribe,test,vapid-public-key}`. Successful merge/close/hold/issue-create/constitution-refresh fire-and-forget a `sendPushToAll(...)` (which never throws — failures are logged, expired 410/404 endpoints are GCed). VAPID identity is read from `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_EMAIL` Replit Secrets.
    - `web-push`