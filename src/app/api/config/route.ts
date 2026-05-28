import { NextResponse } from "next/server";

// Returns public Supabase config at runtime so the client bundle does not
// need NEXT_PUBLIC_* vars baked in at Docker build time. fly.io secrets
// (set via `fly secrets set`) are available here as process.env.
export async function GET() {
  return NextResponse.json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  });
}
