/**
 * Bounded chat-history window for the LLM prompt.
 *
 * The chat route used to load the ENTIRE session transcript into every
 * request. That fails in two escalating ways as a session grows:
 *
 *   1. PostgREST silently caps un-limited selects (default max-rows 1000).
 *      Because the route ordered ascending, the cap kept the OLDEST rows
 *      and dropped the newest — including the message the user just sent.
 *   2. Long before that, the prompt outgrows the model's context window.
 *      The provider 400s, and since the user message is persisted before
 *      the LLM call, history only grows — every later turn fails too and
 *      the session is permanently wedged.
 *
 * This module turns the transcript into a budgeted window: the newest
 * messages, capped by count and by an estimated character budget, always
 * including the newest message (the turn being answered).
 */

export type HistoryMessage = { role: string; content: string };

/** Max rows fetched from the DB per turn (also the window's message cap). */
export const MAX_HISTORY_MESSAGES = 120;

/**
 * Char budget for the history window — ≈24k tokens at ~4 chars/token,
 * comfortably inside every supported model's context window even when
 * stacked on the system prompt and an 8192-token completion budget.
 */
export const MAX_HISTORY_CHARS = 96_000;

export type HistoryWindow = {
  /** Oldest→newest messages that fit the budget. Never empty unless the input is. */
  messages: HistoryMessage[];
  /** How many of the supplied messages were dropped (always the oldest). */
  dropped: number;
};

/**
 * Trim a chronological (oldest→newest) transcript to the budget, keeping
 * the newest messages. The newest message is always kept, even when it
 * alone exceeds the char budget — the provider rejecting one oversized
 * message is a clearer failure than silently sending an empty prompt.
 */
export function budgetChatHistory(
  rows: HistoryMessage[],
  opts: { maxMessages?: number; maxChars?: number } = {},
): HistoryWindow {
  const maxMessages = opts.maxMessages ?? MAX_HISTORY_MESSAGES;
  const maxChars = opts.maxChars ?? MAX_HISTORY_CHARS;
  if (rows.length === 0) return { messages: [], dropped: 0 };

  const kept: HistoryMessage[] = [];
  let chars = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const len = rows[i].content.length;
    const isNewest = kept.length === 0;
    if (!isNewest && (kept.length >= maxMessages || chars + len > maxChars)) {
      break;
    }
    kept.push(rows[i]);
    chars += len;
  }
  kept.reverse();
  return { messages: kept, dropped: rows.length - kept.length };
}

/**
 * System note injected ahead of a trimmed history so the model knows it
 * is not seeing the whole conversation (otherwise it confidently
 * hallucinates the missing context).
 */
export const HISTORY_OMITTED_NOTE =
  "Note: earlier messages in this conversation were omitted to fit the " +
  "model's context window. If something from the earlier discussion " +
  "matters here, ask the user to restate it rather than guessing.";
