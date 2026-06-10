import { NextResponse } from "next/server";
import { updateSkill, deleteSkill, MAX_SKILL_CONTENT } from "@/lib/skills";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { id: string } };

/**
 * PATCH /api/skills/:id { enabled?, content?, description? }
 * Toggle a skill on/off or update its body/description.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  let body: { enabled?: unknown; content?: unknown; description?: unknown };
  try {
    body = (await req.json()) as {
      enabled?: unknown;
      content?: unknown;
      description?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: { enabled?: boolean; content?: string; description?: string } =
    {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "enabled must be a boolean" },
        { status: 400 },
      );
    }
    patch.enabled = body.enabled;
  }
  if (body.content !== undefined) {
    if (typeof body.content !== "string") {
      return NextResponse.json(
        { error: "content must be a string" },
        { status: 400 },
      );
    }
    if (body.content.length > MAX_SKILL_CONTENT) {
      return NextResponse.json(
        { error: `content exceeds ${MAX_SKILL_CONTENT} chars` },
        { status: 400 },
      );
    }
    patch.content = body.content;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      return NextResponse.json(
        { error: "description must be a string" },
        { status: 400 },
      );
    }
    patch.description = body.description;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "nothing to update (enabled, content, or description)" },
      { status: 400 },
    );
  }

  try {
    await updateSkill(id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "update failed" },
      { status: 500 },
    );
  }
}

/** DELETE /api/skills/:id */
export async function DELETE(_req: Request, { params }: Ctx) {
  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  try {
    await deleteSkill(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
}
