/**
 * Skills — Claude-style SKILL.md modules the operator installs to extend the
 * assistant. Each skill has YAML-ish frontmatter (name, description, optional
 * triggers) followed by a markdown body of instructions.
 *
 * Injection strategy (token-aware, mirrors the old constitution's Tier-1/2
 * idea): every enabled skill is ALWAYS advertised to the model by name +
 * description. The full body is only injected when the user's message matches
 * the skill's name or one of its triggers, so an installed library of skills
 * doesn't blow up the prompt on unrelated turns.
 *
 * All read helpers degrade to [] / safe defaults on failure.
 */
import { getServerSupabase } from "./supabase";

export type Skill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  content: string;
  triggers: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export const MAX_SKILL_CONTENT = 20000;
const SELECT =
  "id, slug, name, description, content, triggers, enabled, created_at, updated_at";

export type ParsedSkill = {
  name: string;
  description: string;
  triggers: string[];
  content: string;
};

/**
 * Parse a SKILL.md document into structured fields. Supports an optional
 * leading `---` YAML frontmatter block with `name`, `description`, and
 * `triggers` (comma- or array-style). Falls back to the first `# Heading`
 * for the name when no frontmatter is present. The body (sans frontmatter)
 * becomes `content`.
 */
export function parseSkillMarkdown(md: string): ParsedSkill {
  const text = (md ?? "").trim();
  let name = "";
  let description = "";
  let triggers: string[] = [];
  let body = text;

  const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (fm) {
    const front = fm[1];
    body = fm[2].trim();
    for (const line of front.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (key === "name") name = val;
      else if (key === "description") description = val;
      else if (key === "triggers") triggers = splitList(val);
    }
  }

  if (!name) {
    const h1 = body.match(/^#\s+(.+)$/m);
    name = h1 ? h1[1].trim() : "Untitled skill";
  }
  if (!description) {
    // First non-empty, non-heading line.
    const line = body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#"));
    description = line ? line.slice(0, 280) : "";
  }

  return { name, description, triggers, content: body.slice(0, MAX_SKILL_CONTENT) };
}

function splitList(val: string): string[] {
  let v = val.trim();
  if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
  return v
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .filter(Boolean);
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `skill-${Date.now().toString(36)}`
  );
}

export async function listSkills(): Promise<Skill[]> {
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("skills")
      .select(SELECT)
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data as Skill[];
  } catch {
    return [];
  }
}

export async function getEnabledSkills(): Promise<Skill[]> {
  return (await listSkills()).filter((s) => s.enabled);
}

/** Install a skill from a raw SKILL.md document. Slug collisions get suffixed. */
export async function createSkillFromMarkdown(md: string): Promise<Skill> {
  const parsed = parseSkillMarkdown(md);
  const supabase = getServerSupabase();

  let slug = slugify(parsed.name);
  // Avoid unique-constraint failures on duplicate names.
  const { data: existing } = await supabase
    .from("skills")
    .select("slug")
    .like("slug", `${slug}%`);
  if (existing && existing.length > 0) {
    const taken = new Set((existing as { slug: string }[]).map((r) => r.slug));
    if (taken.has(slug)) {
      let n = 2;
      while (taken.has(`${slug}-${n}`)) n += 1;
      slug = `${slug}-${n}`;
    }
  }

  const { data, error } = await supabase
    .from("skills")
    .insert({
      slug,
      name: parsed.name,
      description: parsed.description,
      content: parsed.content,
      triggers: parsed.triggers,
      enabled: true,
    })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as Skill;
}

export async function updateSkill(
  id: string,
  patch: { enabled?: boolean; content?: string; description?: string },
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.content !== undefined) {
    const parsed = parseSkillMarkdown(patch.content);
    row.content = parsed.content;
    if (patch.description === undefined) row.description = parsed.description;
  }
  const supabase = getServerSupabase();
  const { error } = await supabase.from("skills").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteSkill(id: string): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase.from("skills").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** True when the user's message references a skill by name or trigger word. */
export function skillMatches(skill: Skill, userMessage: string): boolean {
  const haystack = userMessage.toLowerCase();
  if (skill.name && haystack.includes(skill.name.toLowerCase())) return true;
  return skill.triggers.some((t) => t && haystack.includes(t));
}

/**
 * Render the skills block for the system prompt. Lists every enabled skill;
 * inlines the full body for skills matched by the current message.
 * Returns "" when no skills are enabled.
 */
export function renderSkillsSection(skills: Skill[], userMessage: string): string {
  const enabled = skills.filter((s) => s.enabled);
  if (enabled.length === 0) return "";

  const list = enabled
    .map((s) => `- **${s.name}** — ${s.description || "(no description)"}`)
    .join("\n");

  const active = enabled.filter((s) => skillMatches(s, userMessage));
  const bodies = active
    .map((s) => `### Skill: ${s.name}\n${s.content.trim()}`)
    .join("\n\n");

  let section = `## SKILLS\nInstalled skills you can use. Apply a skill's instructions when the task calls for it:\n${list}`;
  if (bodies) {
    section += `\n\n${bodies}`;
  }
  return section;
}
