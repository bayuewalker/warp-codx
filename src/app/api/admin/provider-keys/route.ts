import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/roles";
import {
  listProviderKeys,
  createProviderKey,
  toPublic,
  isProvider,
} from "@/lib/provider-keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function gate(result: Awaited<ReturnType<typeof requireAdmin>>) {
  if ("error" in result) {
    const status = result.error === "unauthenticated" ? 401 : 403;
    return NextResponse.json({ error: result.error }, { status });
  }
  return null;
}

/** GET /api/admin/provider-keys → { keys } (masked, never raw). */
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  const denied = gate(auth);
  if (denied) return denied;

  const keys = (await listProviderKeys()).map(toPublic);
  return NextResponse.json({ keys });
}

/** POST /api/admin/provider-keys { provider, apiKey, label?, priority? } */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  const denied = gate(auth);
  if (denied) return denied;

  let body: {
    provider?: unknown;
    apiKey?: unknown;
    label?: unknown;
    priority?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isProvider(body.provider)) {
    return NextResponse.json(
      { error: "provider must be one of: openrouter, openai, blackbox" },
      { status: 400 },
    );
  }
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "apiKey (non-empty string) is required" },
      { status: 400 },
    );
  }
  const label = typeof body.label === "string" ? body.label : "";
  const priority =
    typeof body.priority === "number" && Number.isFinite(body.priority)
      ? Math.trunc(body.priority)
      : undefined;

  try {
    const key = await createProviderKey({
      provider: body.provider,
      apiKey,
      label,
      priority,
    });
    return NextResponse.json({ key: toPublic(key) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "create failed" },
      { status: 500 },
    );
  }
}
