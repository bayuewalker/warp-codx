import { NextResponse } from "next/server";
import { createSkillFromMarkdown, MAX_SKILL_CONTENT } from "@/lib/skills";
import { fetchSkillMarkdownFromUrl } from "@/lib/skill-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/skills/import { url } → { skill }
 * Installs a skill from a public GitHub link to a SKILL.md / *.md file.
 * Available to all signed-in users (mirrors the paste/upload install paths).
 */
export async function POST(req: Request) {
  let body: { url?: unknown };
  try {
    body = (await req.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json(
      { error: "url (non-empty string) is required" },
      { status: 400 },
    );
  }

  let markdown: string;
  try {
    markdown = await fetchSkillMarkdownFromUrl(url);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fetch failed" },
      { status: 400 },
    );
  }
  if (markdown.length > MAX_SKILL_CONTENT + 8 * 1024) {
    return NextResponse.json(
      { error: `content exceeds ${MAX_SKILL_CONTENT} chars` },
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
