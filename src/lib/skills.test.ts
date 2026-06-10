/**
 * Tests for the pure skill helpers: SKILL.md parsing, slugging, message
 * matching, and system-prompt rendering. The Supabase CRUD paths are covered
 * indirectly (they delegate to parseSkillMarkdown) and degrade to [] on error.
 */
import { describe, expect, it } from "vitest";
import {
  parseSkillMarkdown,
  slugify,
  skillMatches,
  renderSkillsSection,
  type Skill,
} from "./skills";

function makeSkill(over: Partial<Skill>): Skill {
  return {
    id: "1",
    slug: "s",
    name: "Skill",
    description: "desc",
    content: "body",
    triggers: [],
    enabled: true,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("parseSkillMarkdown", () => {
  it("parses YAML frontmatter (name, description, triggers list)", () => {
    const md = `---
name: Python Expert
description: Idiomatic Python
triggers: python, pytest, django
---

When writing Python, use type hints.`;
    const p = parseSkillMarkdown(md);
    expect(p.name).toBe("Python Expert");
    expect(p.description).toBe("Idiomatic Python");
    expect(p.triggers).toEqual(["python", "pytest", "django"]);
    expect(p.content).toBe("When writing Python, use type hints.");
  });

  it("parses array-style triggers and strips quotes", () => {
    const md = `---
name: "Quoted Name"
triggers: [react, "next.js"]
---
Body here.`;
    const p = parseSkillMarkdown(md);
    expect(p.name).toBe("Quoted Name");
    expect(p.triggers).toEqual(["react", "next.js"]);
  });

  it("falls back to the first H1 + first line when no frontmatter", () => {
    const md = `# My Skill\n\nDoes a useful thing.`;
    const p = parseSkillMarkdown(md);
    expect(p.name).toBe("My Skill");
    expect(p.description).toBe("Does a useful thing.");
    expect(p.triggers).toEqual([]);
    expect(p.content).toContain("My Skill");
  });

  it("uses a placeholder name when nothing is parseable", () => {
    expect(parseSkillMarkdown("just some text").name).toBe("Untitled skill");
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Python Expert!")).toBe("python-expert");
  });
  it("never returns empty", () => {
    expect(slugify("!!!").startsWith("skill-")).toBe(true);
  });
});

describe("skillMatches", () => {
  const s = makeSkill({ name: "Python Expert", triggers: ["pytest", "django"] });
  it("matches on name", () => {
    expect(skillMatches(s, "help me with Python Expert please")).toBe(true);
  });
  it("matches on a trigger word", () => {
    expect(skillMatches(s, "my DJANGO view is broken")).toBe(true);
  });
  it("does not match unrelated text", () => {
    expect(skillMatches(s, "write some rust")).toBe(false);
  });
});

describe("renderSkillsSection", () => {
  it("returns '' when no skills are enabled", () => {
    expect(renderSkillsSection([makeSkill({ enabled: false })], "x")).toBe("");
    expect(renderSkillsSection([], "x")).toBe("");
  });

  it("always lists enabled skills and inlines only matched bodies", () => {
    const a = makeSkill({
      id: "a",
      name: "Python",
      description: "py",
      content: "PY_BODY",
      triggers: ["python"],
    });
    const b = makeSkill({
      id: "b",
      name: "Rust",
      description: "rs",
      content: "RUST_BODY",
      triggers: ["rust"],
    });
    const out = renderSkillsSection([a, b], "fix my python script");
    // Both advertised in the list.
    expect(out).toContain("**Python**");
    expect(out).toContain("**Rust**");
    // Only the matched skill's body is inlined.
    expect(out).toContain("PY_BODY");
    expect(out).not.toContain("RUST_BODY");
  });
});
