import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/roles";
import { adminGateResponse } from "@/lib/route-helpers";
import { getProviderKey } from "@/lib/provider-keys";
import { providerBaseURL } from "@/lib/provider";
import { fetchProviderBalance } from "@/lib/provider-balance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { id: string } };

/**
 * GET /api/admin/provider-keys/:id/balance
 *
 * Looks up the stored (raw) key by id server-side, queries the provider's
 * balance API, and returns a masked-safe balance result. The raw key is never
 * echoed back to the browser.
 */
export async function GET(req: Request, { params }: Ctx) {
  const denied = adminGateResponse(await requireAdmin(req));
  if (denied) return denied;
  if (!params.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const key = await getProviderKey(params.id);
  if (!key) {
    return NextResponse.json({ error: "key not found" }, { status: 404 });
  }

  const balance = await fetchProviderBalance(
    key.provider,
    key.api_key.trim(),
    providerBaseURL(key.provider),
  );
  return NextResponse.json({ balance });
}
