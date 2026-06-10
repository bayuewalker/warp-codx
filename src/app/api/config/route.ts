import { NextResponse } from "next/server";
import { getProvider } from "@/lib/provider";
import { getModel } from "@/lib/models";

export const dynamic = "force-dynamic";

// Returns public Supabase config + the active LLM provider/model at runtime so
// the client bundle does not need NEXT_PUBLIC_* vars baked in at Docker build
// time. fly.io secrets (set via `fly secrets set`) are available here as
// process.env.
export async function GET() {
  // SUPABASE_URL/SUPABASE_ANON_KEY (no NEXT_PUBLIC_ prefix) are never
  // webpack-inlined — they always read from fly.io secrets at runtime.
  // Fall back to bracket-notation NEXT_PUBLIC_ reads for local dev compat.

  // Provider/model resolution is best-effort: an unknown LLM_PROVIDER value
  // throws, so guard it here and degrade to nulls rather than 500 the config
  // endpoint the client relies on for Supabase bootstrap.
  let provider: string | null = null;
  let model: string | null = null;
  try {
    provider = getProvider();
    model = getModel("cmd");
  } catch {
    /* provider misconfigured — surfaced at chat time, not here */
  }

  return NextResponse.json({
    supabaseUrl:
      process.env.SUPABASE_URL ?? process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "",
    supabaseAnonKey:
      process.env.SUPABASE_ANON_KEY ??
      process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ??
      "",
    provider,
    model,
  });
}
