import { NextResponse } from "next/server";
import {
  listMemories,
  createMemory,
  type MemoryStatus,
} from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUSES: MemoryStatus[] = ["active", "pending", "archived"];

/** GET /api/memory?status=active|pending|archived → { memories } */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam && (STATUSES as string[]).includes(statusParam)
      ? (statusParam as MemoryStatus)
      : undefined;
  const memories = await listMemories(status);
  return NextResponse.json({ memories });
}

/** POST /api/memory { content } → { memory } (manual, active) */
export async function POST(req: Request) {
  let body: { content?: unknown };
  try {
    body = (await req.json()) as { content?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const content =
    typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json(
      { error: "content (non-empty string) is required" },
      { status: 400 },
    );
  }
  try {
    const memory = await createMemory(content, "manual", "active");
    return NextResponse.json({ memory }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "create failed" },
      { status: 500 },
    );
  }
}
