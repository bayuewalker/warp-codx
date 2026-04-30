# WARP CodX

Mobile-first command interface for orchestrating AI agents in WalkerMind OS.

## Stack

- **Framework**: Next.js 14 (App Router) — standalone, no monorepo
- **Language**: TypeScript
- **Styling**: Tailwind CSS, dark mode default
- **Database & Realtime**: Supabase (`@supabase/supabase-js`)
- **AI**: OpenAI SDK pointed at OpenRouter gateway (streaming). Default model `openai/gpt-4o`. Model registry in `src/lib/models.ts`.
- **Node**: 24 (any modern Node ≥ 18.17 works)

## Project layout

- `src/app/` — App Router routes and layout
- `src/app/api/` — Route Handlers (sessions, messages, chat)
- `src/components/` — Client components (sidebar, chat, input)
- `src/lib/` — Supabase clients, OpenAI helpers, hooks, utils

## Scripts

- `npm run dev` — start dev server on port 3000
- `npm run build` — production build
- `npm start` — run production build on port 3000
- `npm run lint` — run Next.js lint

## Environment variables

See `.env.example`. All four are required:

- `OPENROUTER_API_KEY` (format `sk-or-v1-...`, get one at https://openrouter.ai/keys)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `NEXT_PUBLIC_SITE_URL` *(optional, used for OpenRouter `HTTP-Referer` attribution)*

> Note: the server-side Supabase client passes a `cache: "no-store"` fetch to opt out of Next.js 14's route-handler Data Cache. Without this, `GET` queries return stale empty results after fresh inserts in a previous request.

## Supabase schema

Run the SQL in `supabase.sql` in the Supabase SQL Editor before first use.

## Portability

This project is a vanilla Next.js 14 app with **zero** Replit-specific code paths.
It deploys as-is to fly.io, Vercel, or any Node.js host:

```
npm install
npm run build
npm start
```
