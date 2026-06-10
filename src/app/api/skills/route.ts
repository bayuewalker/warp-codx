import { NextResponse } from "next/server";
import {
  listSkills,
  createSkillFromMarkdown,
  MAX_SKILL_CONTENT,
} from "@/lib/skills";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/skills → { skills } */
export async function GET() {
  const skills = await listSkills();
  return NextResponse.json({ skills });
}

/**
 * POST /api/skills { markdown } → { skill }
 * Installs a skill from a raw SKILL.md document (frontmatter + body).
 */
export async function POST(req: Request) {
  let body: { markdown?: unknown };
  try {
    body = (await req.json()) as { markdown?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const markdown =
    typeof body.markdown === "string" ? body.markdown.trim() : "";
  if (!markdown) {
    return NextResponse.json(
      { error: "markdown (non-empty string) is required" },
      { status: 400 },
    );
  }
  if (markdown.length > MAX_SKILL_CONTENT) {
    return NextResponse.json(
      { error: `markdown exceeds ${MAX_SKILL_CONTENT} chars` },
      { status: 400 },
    );
  }
  try {
    const skill = await createSkillFromMarkdown(markdown);
    return NextResponse.json({ skill }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "install failed" },
      { status: 500 },
    );
  }
}
