import { NextResponse } from "next/server";
import {
  getCustomInstructions,
  setCustomInstructions,
  MAX_CUSTOM_INSTRUCTIONS,
} from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/settings → { customInstructions } */
export async function GET() {
  const customInstructions = await getCustomInstructions();
  return NextResponse.json({ customInstructions });
}

/** PUT /api/settings { customInstructions } → { customInstructions } */
export async function PUT(req: Request) {
  let body: { customInstructions?: unknown };
  try {
    body = (await req.json()) as { customInstructions?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.customInstructions !== "string") {
    return NextResponse.json(
      { error: "customInstructions (string) is required" },
      { status: 400 },
    );
  }
  if (body.customInstructions.length > MAX_CUSTOM_INSTRUCTIONS) {
    return NextResponse.json(
      { error: `customInstructions exceeds ${MAX_CUSTOM_INSTRUCTIONS} chars` },
      { status: 400 },
    );
  }
  try {
    await setCustomInstructions(body.customInstructions);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "save failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({
    customInstructions: await getCustomInstructions(),
  });
}
