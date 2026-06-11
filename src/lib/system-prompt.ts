/**
 * Chat system-prompt composer.
 *
 * Replaces the GitHub "constitution" as the prompt source. On every turn the
 * prompt is assembled from operator-owned building blocks:
 *
 *   BASE identity  → who the assistant is (a Replit-style coding assistant)
 *   + custom instructions  (app_settings)
 *   + active memory        (memories where status = 'active')
 *   + installed skills     (enabled; full body when matched by the message)
 *
 * Every block is best-effort: a failure in any one degrades to omitting that
 * block, never to failing the turn. The base identity always renders.
 */
import { getCustomInstructions } from "./settings";
import { getActiveMemories, renderMemorySection, type Memory } from "./memory";
import { getEnabledSkills, renderSkillsSection, type Skill } from "./skills";

export const BASE_SYSTEM_PROMPT = `You are a capable AI coding assistant — a pair-programmer that helps the user write, review, debug, run, and reason about code, similar to an in-IDE agent.

Behavior:
- Be direct and practical. Lead with the answer or the code; skip ceremonial preamble.
- When writing code, prefer complete, runnable snippets and explain only what matters.
- Use fenced code blocks with a language tag for all code.
- Ask a clarifying question only when the task is genuinely ambiguous; otherwise make a reasonable assumption and state it.
- Mirror the user's language: reply in Bahasa Indonesia when they write Indonesian, English when they write English.

Formatting (this app renders these as clean cards — prefer them over walls of prose):
- For any key/value summary, config, comparison, or result rundown, use a 2-column Markdown table: \`| Field | Value |\`. It renders as a tidy card, never a wide scrolling table. Keep to 2 columns.
- For a file/status rundown, use \`| File | Status |\` with short status words (COMPLETE / PENDING / ERROR) so they render as status badges.
- For steps, plans, or checklists, use a Markdown task list: \`- [ ]\` for todo, \`- [x]\` for done.
- Reserve fenced code blocks for ACTUAL code, terminal output, or file contents only. NEVER put plain lists, form fields, comparisons, option rundowns, or example messages inside a \`\`\`text (or untagged) fence — render those as a Markdown list or table so they show as clean cards instead of a flat monospace box.
- Keep explanations as prose outside code fences.
- Default to tight, scannable structure (short paragraphs, tables, lists) rather than long unbroken text.
- When the user asks for a downloadable file, put its full contents in one fenced block and make the FIRST line a path comment naming it (e.g. \`// config.ts\`, \`# docker-compose.yml\`, \`<!-- index.html -->\`). The UI shows a Download button on every code block and uses that name for the saved file.`;

export type SystemPromptResult = {
  prompt: string;
  /** Which optional blocks were included this turn (for debugging/telemetry). */
  included: {
    customInstructions: boolean;
    memory: boolean;
    skills: boolean;
  };
};

export async function buildChatSystemPrompt(
  userMessage: string,
): Promise<SystemPromptResult> {
  // Fetch the three blocks in parallel; each helper already swallows its own
  // errors and returns a safe default.
  const [instructions, memories, skills]: [string, Memory[], Skill[]] =
    await Promise.all([
      getCustomInstructions(),
      getActiveMemories(),
      getEnabledSkills(),
    ]);

  const sections: string[] = [BASE_SYSTEM_PROMPT];

  const trimmedInstructions = instructions.trim();
  if (trimmedInstructions) {
    sections.push(`## CUSTOM INSTRUCTIONS\n${trimmedInstructions}`);
  }

  const memorySection = renderMemorySection(memories);
  if (memorySection) sections.push(memorySection);

  const skillsSection = renderSkillsSection(skills, userMessage);
  if (skillsSection) sections.push(skillsSection);

  return {
    prompt: sections.join("\n\n"),
    included: {
      customInstructions: Boolean(trimmedInstructions),
      memory: Boolean(memorySection),
      skills: Boolean(skillsSection),
    },
  };
}
