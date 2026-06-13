/**
 * Tests for the chat system-prompt composer. The three block sources
 * (settings, memory, skills) are mocked so we assert composition behavior:
 * base always present, optional blocks included only when non-empty, and the
 * `included` flags reflect what was added.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getCustomInstructions,
  getActiveMemories,
  renderMemorySection,
  getEnabledSkills,
  renderSkillsSection,
} = vi.hoisted(() => ({
  getCustomInstructions: vi.fn(),
  getActiveMemories: vi.fn(),
  renderMemorySection: vi.fn(),
  getEnabledSkills: vi.fn(),
  renderSkillsSection: vi.fn(),
}));

vi.mock("./settings", () => ({ getCustomInstructions }));
vi.mock("./memory", () => ({
  getActiveMemories,
  renderMemorySection,
}));
vi.mock("./skills", () => ({
  getEnabledSkills,
  renderSkillsSection,
}));

import { buildChatSystemPrompt, BASE_SYSTEM_PROMPT } from "./system-prompt";

afterEach(() => {
  vi.clearAllMocks();
});

function setup(opts: {
  instructions?: string;
  memory?: string;
  skills?: string;
}) {
  getCustomInstructions.mockResolvedValue(opts.instructions ?? "");
  getActiveMemories.mockResolvedValue([]);
  getEnabledSkills.mockResolvedValue([]);
  renderMemorySection.mockReturnValue(opts.memory ?? "");
  renderSkillsSection.mockReturnValue(opts.skills ?? "");
}

describe("buildChatSystemPrompt", () => {
  it("returns only the base prompt when every block is empty", async () => {
    setup({});
    const { prompt, included } = await buildChatSystemPrompt("hi");
    expect(prompt).toBe(BASE_SYSTEM_PROMPT);
    expect(included).toEqual({
      customInstructions: false,
      memory: false,
      skills: false,
    });
  });

  it("includes each non-empty block in order and sets flags", async () => {
    setup({
      instructions: "Be terse",
      memory: "## MEMORY\n- likes TS",
      skills: "## SKILLS\n- Python",
    });
    const { prompt, included } = await buildChatSystemPrompt("hi");

    expect(prompt.startsWith(BASE_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain("## CUSTOM INSTRUCTIONS\nBe terse");
    expect(prompt).toContain("## MEMORY\n- likes TS");
    expect(prompt).toContain("## SKILLS\n- Python");

    // Order: base < instructions < memory < skills.
    const iBase = prompt.indexOf(BASE_SYSTEM_PROMPT);
    const iInstr = prompt.indexOf("CUSTOM INSTRUCTIONS");
    const iMem = prompt.indexOf("## MEMORY");
    const iSkill = prompt.indexOf("## SKILLS");
    expect(iBase).toBeLessThan(iInstr);
    expect(iInstr).toBeLessThan(iMem);
    expect(iMem).toBeLessThan(iSkill);

    expect(included).toEqual({
      customInstructions: true,
      memory: true,
      skills: true,
    });
  });

  it("passes the user message through to skill matching", async () => {
    setup({});
    await buildChatSystemPrompt("fix my python");
    expect(renderSkillsSection).toHaveBeenCalledWith([], "fix my python");
  });

  it("teaches the rich output formats and gates them to value-adding cases", () => {
    // The formatting guide must document the typed fences/headings so the
    // model actually emits renderable output…
    expect(BASE_SYSTEM_PROMPT).toContain("warp-todos");
    expect(BASE_SYSTEM_PROMPT).toContain("warp-diff");
    expect(BASE_SYSTEM_PROMPT).toContain("## ✅ TODO");
    // …and the formatting guidance must keep its balance: reach for structure
    // when it helps, but never force rich blocks onto a plain-text answer.
    expect(BASE_SYSTEM_PROMPT).toContain("match the format to the content");
    expect(BASE_SYSTEM_PROMPT).toMatch(/a rich format is never mandatory/);
  });
});
