/**
 * Phase 3.5 — Pre-pass extractor that pulls every "rich-block" fenced
 * code block (`warp-action`, `warp-diff`, `warp-todos`, `warp-status`)
 * out of the raw markdown so they can be rendered as a discrete
 * cluster (and wrapped in `<CollapsibleSection>` when 2+).
 *
 * The fence regex is line-anchored on both ends — both the opening
 * fence (` ```warp-* ` at start of line) and the closing fence
 * (` ``` ` on its own line) must sit at column 0. This mirrors
 * CommonMark fence-boundary semantics and prevents the extractor
 * from mis-firing on the same string appearing INSIDE another
 * fenced code block (e.g. a JS template literal documenting the
 * marker).
 *
 * Malformed fences (invalid JSON body) are stripped — the body is
 * dropped from the prose AND no block is emitted. This matches the
 * defensive philosophy of the marker extractors (`extractIssueDraft`,
 * `extractPRAction`, `extractTaskComplete`): never leak raw JSON into
 * the user-facing bubble, never mount a card with bad data.
 *
 * Lives in `src/lib` (rather than co-located in `MessageContent.tsx`)
 * so it can be unit-tested without standing up a JSX environment.
 */

import type {
  ActionPayload,
  DiffPayload,
  StatusPayload,
  TodosPayload,
} from "@/lib/types";

export type RichBlockSpec =
  | { kind: "action"; payload: ActionPayload }
  | { kind: "diff"; payload: DiffPayload }
  | { kind: "todos"; payload: TodosPayload }
  | { kind: "status"; payload: StatusPayload };

const RICH_FENCE_RE =
  /^```(warp-action|warp-diff|warp-todos|warp-status)[ \t]*\n([\s\S]*?)\n```[ \t]*(?=\n|$)/gm;

export function extractRichBlocks(raw: string): {
  proseOnly: string;
  blocks: RichBlockSpec[];
} {
  const blocks: RichBlockSpec[] = [];
  const proseOnly = raw.replace(
    RICH_FENCE_RE,
    (_full, lang: string, body: string) => {
      const trimmed = body.trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return "";
      }
      switch (lang) {
        case "warp-action":
          blocks.push({ kind: "action", payload: parsed as ActionPayload });
          return "";
        case "warp-diff":
          blocks.push({ kind: "diff", payload: parsed as DiffPayload });
          return "";
        case "warp-todos":
          blocks.push({ kind: "todos", payload: parsed as TodosPayload });
          return "";
        case "warp-status":
          blocks.push({ kind: "status", payload: parsed as StatusPayload });
          return "";
        default:
          return "";
      }
    },
  );
  return { proseOnly: proseOnly.replace(/\n{3,}/g, "\n\n").trim(), blocks };
}
