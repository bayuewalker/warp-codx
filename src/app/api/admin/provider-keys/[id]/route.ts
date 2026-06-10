import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/roles";
import { updateProviderKey, deleteProviderKey } from "@/lib/provider-keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { id: string } };

function gate(result: Awaited<ReturnType<typeof requireAdmin>>) {
  if ("error" in result) {
    const status = result.error === "unauthenticated" ? 401 : 403;
    return NextResponse.json({ error: result.error }, { status });
  }
  return null;
}

/** PATCH /api/admin/provider-keys/:id { enabled?, label?, priority?, apiKey? } */
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = gate(await requireAdmin(req));
  if (denied) return denied;
  if (!params.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  let body: {
    enabled?: unknown;
    label?: unknown;
    priority?: unknown;
    apiKey?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: {
    enabled?: boolean;
    label?: string;
    priority?: number;
    apiKey?: string;
  } = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
    }
    patch.enabled = body.enabled;
  }
  if (body.label !== undefined) {
    if (typeof body.label !== "string") {
      return NextResponse.json({ error: "label must be string" }, { status: 400 });
    }
    patch.label = body.label;
  }
  if (body.priority !== undefined) {
    if (typeof body.priority !== "number" || !Number.isFinite(body.priority)) {
      return NextResponse.json({ error: "priority must be a number" }, { status: 400 });
    }
    patch.priority = Math.trunc(body.priority);
  }
  if (body.apiKey !== undefined) {
    if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
      return NextResponse.json(
        { error: "apiKey must be a non-empty string" },
        { status: 400 },
      );
    }
    patch.apiKey = body.apiKey;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  try {
    await updateProviderKey(params.id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "update failed" },
      { status: 500 },
    );
  }
}

/** DELETE /api/admin/provider-keys/:id */
export async function DELETE(req: Request, { params }: Ctx) {
  const denied = gate(await requireAdmin(req));
  if (denied) return denied;
  if (!params.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  try {
    await deleteProviderKey(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
}
