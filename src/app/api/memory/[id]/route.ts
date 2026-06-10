import { NextResponse } from "next/server";
import {
  updateMemory,
  deleteMemory,
  type MemoryStatus,
} from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUSES: MemoryStatus[] = ["active", "pending", "archived"];

type Ctx = { params: { id: string } };

/**
 * PATCH /api/memory/:id { content?, status? }
 * Used to edit text, or to approve (status='active') / archive a pending
 * auto-memory.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  let body: { content?: unknown; status?: unknown };
  try {
    body = (await req.json()) as { content?: unknown; status?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: { content?: string; status?: MemoryStatus } = {};
  if (body.content !== undefined) {
    if (typeof body.content !== "string" || !body.content.trim()) {
      return NextResponse.json(
        { error: "content must be a non-empty string" },
        { status: 400 },
      );
    }
    patch.content = body.content;
  }
  if (body.status !== undefined) {
    if (
      typeof body.status !== "string" ||
      !(STATUSES as string[]).includes(body.status)
    ) {
      return NextResponse.json(
        { error: `status must be one of: ${STATUSES.join(", ")}` },
        { status: 400 },
      );
    }
    patch.status = body.status as MemoryStatus;
  }
  if (patch.content === undefined && patch.status === undefined) {
    return NextResponse.json(
      { error: "nothing to update (provide content and/or status)" },
      { status: 400 },
    );
  }

  try {
    await updateMemory(id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "update failed" },
      { status: 500 },
    );
  }
}

/** DELETE /api/memory/:id */
export async function DELETE(_req: Request, { params }: Ctx) {
  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  try {
    await deleteMemory(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
}
