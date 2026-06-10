/**
 * Custom instructions — a single global instruction blob the operator can
 * edit, injected into every chat system prompt.
 *
 * Single-tenant: stored in the `app_settings` singleton row (id = 1). All
 * reads degrade to "" on any failure (missing table, network) so a chat turn
 * never breaks just because settings are unavailable.
 */
import { getServerSupabase } from "./supabase";

export const MAX_CUSTOM_INSTRUCTIONS = 8000;

export async function getCustomInstructions(): Promise<string> {
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("app_settings")
      .select("custom_instructions")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return "";
    return ((data as { custom_instructions?: string }).custom_instructions ?? "").trim();
  } catch {
    return "";
  }
}

export async function setCustomInstructions(text: string): Promise<void> {
  const trimmed = text.slice(0, MAX_CUSTOM_INSTRUCTIONS);
  const supabase = getServerSupabase();
  const { error } = await supabase.from("app_settings").upsert(
    {
      id: 1,
      custom_instructions: trimmed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(error.message);
}
