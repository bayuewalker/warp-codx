/**
 * Memory — durable facts/preferences injected into every chat system prompt.
 *
 * Two sources:
 *   - manual: the operator adds/edits entries in Settings → Memory.
 *   - auto:   extracted from chat turns by a cheap model; lands as `pending`
 *             so the operator reviews before it becomes `active`.
 *
 * Only `active` entries are injected. All read helpers degrade to [] on
 * failure so a missing table never breaks a chat turn.
 */
import { getServerSupabase } from "./supabase";
import { createCompletionWithFailover } from "./llm";

export type MemoryStatus = "active" | "pending" | "archived";
export type MemorySource = "manual" | "auto";

export type Memory = {
  id: string;
  content: string;
  source: MemorySource;
  status: MemoryStatus;
  created_at: string;
  updated_at: string;
};

export const MAX_MEMORY_CONTENT = 2000;
const SELECT = "id, content, source, status, created_at, updated_at";

export async function listMemories(status?: MemoryStatus): Promise<Memory[]> {
  try {
    const supabase = getServerSupabase();
    let query = supabase
      .from("memories")
      .select(SELECT)
      .order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error || !data) return [];
    return data as Memory[];
  } catch {
    return [];
  }
}

export async function getActiveMemories(): Promise<Memory[]> {
  return listMemories("active");
}

export async function createMemory(
  content: string,
  source: MemorySource = "manual",
  status: MemoryStatus = "active",
): Promise<Memory> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("memories")
    .insert({ content: content.trim().slice(0, MAX_MEMORY_CONTENT), source, status })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as Memory;
}

export async function updateMemory(
  id: string,
  patch: { content?: string; status?: MemoryStatus },
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.content !== undefined)
    row.content = patch.content.trim().slice(0, MAX_MEMORY_CONTENT);
  if (patch.status !== undefined) row.status = patch.status;
  const supabase = getServerSupabase();
  const { error } = await supabase.from("memories").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteMemory(id: string): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase.from("memories").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Render the active-memory block for the system prompt. Returns "" when
 * there's nothing to inject so the caller can skip the section cleanly.
 */
export function renderMemorySection(memories: Memory[]): string {
  const active = memories.filter((m) => m.status === "active" && m.content.trim());
  if (active.length === 0) return "";
  const lines = active.map((m) => `- ${m.content.trim()}`).join("\n");
  return `## MEMORY\nThings to remember about the user and their preferences:\n${lines}`;
}

const EXTRACTION_SYSTEM = `You extract durable, reusable facts about the USER from a conversation turn.
Return ONLY a compact JSON array of short strings (max 5). Each string is one
stable fact, preference, or instruction worth remembering for future sessions
(e.g. "Prefers TypeScript over JavaScript", "Works on a Next.js app called X",
"Wants concise answers").

Rules:
- Do NOT include ephemeral/one-off task details, greetings, or questions.
- Do NOT restate the assistant's output.
- If nothing is worth remembering, return [].
- No prose, no markdown — just the JSON array.`;

/**
 * Best-effort extraction of durable memories from one chat turn. New facts are
 * stored as `pending` (review-before-active). De-duplicates against existing
 * active+pending memory contents. Never throws — returns the count inserted.
 */
export async function extractAndStoreMemories(
  userMessage: string,
  assistantReply: string,
): Promise<number> {
  try {
    const { content } = await createCompletionWithFailover({
      role: "echo",
      temperature: 0,
      maxTokens: 300,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM },
        {
          role: "user",
          content: `USER said:\n${userMessage}\n\nASSISTANT replied:\n${assistantReply.slice(0, 2000)}`,
        },
      ],
    });
    const raw = content.trim();
    const candidates = parseCandidates(raw);
    if (candidates.length === 0) return 0;

    // Dedup against everything we already track (case-insensitive).
    const existing = new Set(
      [...(await listMemories("active")), ...(await listMemories("pending"))].map(
        (m) => m.content.trim().toLowerCase(),
      ),
    );
    const fresh = candidates.filter(
      (c) => c && !existing.has(c.toLowerCase()),
    );
    if (fresh.length === 0) return 0;

    const supabase = getServerSupabase();
    const { error } = await supabase.from("memories").insert(
      fresh.map((content) => ({
        content: content.slice(0, MAX_MEMORY_CONTENT),
        source: "auto" as const,
        status: "pending" as const,
      })),
    );
    if (error) return 0;
    return fresh.length;
  } catch {
    return 0;
  }
}

/** Parse the model's JSON-array reply, tolerating code fences / stray text. */
export function parseCandidates(raw: string): string[] {
  if (!raw) return [];
  let text = raw.trim();
  // Strip ```json fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // Fall back to the first [...] block.
  if (!text.startsWith("[")) {
    const arr = text.match(/\[[\s\S]*\]/);
    if (arr) text = arr[0];
  }
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
  } catch {
    return [];
  }
}
