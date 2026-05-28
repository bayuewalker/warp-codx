import { NextResponse } from "next/server";

// Returns public Supabase config at runtime so the client bundle does not
// need NEXT_PUBLIC_* vars baked in at Docker build time. fly.io secrets
// (set via `fly secrets set`) are available here as process.env.
export async function GET() {
  // SUPABASE_URL/SUPABASE_ANON_KEY (no NEXT_PUBLIC_ prefix) are never
  // webpack-inlined — they always read from fly.io secrets at runtime.
  // Fall back to bracket-notation NEXT_PUBLIC_ reads for local dev compat.
  return NextResponse.json({
    supabaseUrl:
      process.env.SUPABASE_URL ?? process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "",
    supabaseAnonKey:
      process.env.SUPABASE_ANON_KEY ??
      process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ??
      "",
  });
}
