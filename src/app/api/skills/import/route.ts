import { NextResponse } from "next/server";
import { createSkillFromMarkdown, MAX_SKILL_CONTENT } from "@/lib/skills";
import {
  fetchSkillMarkdownFromUrl,
  fetchSkillMarkdownFromRepo,
} from "@/lib/skill-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/skills/import → { skill }
 *
 * Two install shapes:
 *   { url }            — direct public GitHub link to a SKILL.md / *.md file
 *   { source, name }   — GitHub "owner/repo" + skill name; the server probes
 *                        the well-known layouts (skills/<name>/SKILL.md,
 *                        <name>/SKILL.md, .claude/skills/<name>/SKILL.md, …)
 *                        on main/master and installs the first hit.
 *
 * Available to all signed-in users (mirrors the paste/upload install paths).
 */
export async function POST(req: Request) {
  let body: { url?: unknown; source?: unknown; name?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const source = typeof body.source === "string" ? body.source.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!url && !(source && name)) {
    return NextResponse.json(
      { error: "Provide either { url } or { source, name }" },
      { status: 400 },
    );
  }

  let markdown: string;
  try {
    markdown = url
      ? await fetchSkillMarkdownFromUrl(url)
      : await fetchSkillMarkdownFromRepo(source, name);
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
