/**
 * Phase 3.5 — Pre-pass extractor that pulls every "rich-block" fenced
 * code block (`warp-action`, `warp-diff`, `warp-todos`, `warp-status`)
 * out of the raw markdown so they can be rendered as React cards.
 *
 * Each well-formed fence is replaced IN PLACE with an invisible slot
 * marker (`RICH_SLOT_<index>`, index into `blocks`) so the
 * renderer (`MessageContent.tsx`) can mount each card exactly where
 * the fence sat in the narration — the Ona/agent-transcript pattern of
 * prose → action row → prose → diff → prose. Consecutive runs of 2+
 * blocks (nothing but whitespace between markers) are grouped behind
 * one `<CollapsibleSection>` by the renderer.
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
 * dropped from the prose AND no block (or slot) is emitted. This
 * matches the defensive philosophy of the marker extractors
 * (`extractIssueDraft`, `extractPRAction`, `extractTaskComplete`):
 * never leak raw JSON into the user-facing bubble, never mount a card
 * with bad data.
 *
 * Lives in `src/lib` (rather than co-located in `MessageContent.tsx`)
 * so it can be unit-tested without standing up a JSX environment.
 */

import type {
  ActionPayload,
  CalloutPayload,
  CommandPayload,
  DiffPayload,
  FilePayload,
  JsonPayload,
  StatusPayload,
  TerminalPayload,
  TodosPayload,
} from "@/lib/types";

export type RichBlockSpec =
  | { kind: "action"; payload: ActionPayload }
  | { kind: "diff"; payload: DiffPayload }
  | { kind: "todos"; payload: TodosPayload }
  | { kind: "status"; payload: StatusPayload }
  | { kind: "terminal"; payload: TerminalPayload }
  | { kind: "command"; payload: CommandPayload }
  | { kind: "callout"; payload: CalloutPayload }
  | { kind: "json"; payload: JsonPayload }
  | { kind: "file"; payload: FilePayload };

const RICH_FENCE_RE =
  /^```(warp-action|warp-diff|warp-todos|warp-status|warp-terminal|warp-command|warp-callout|warp-json|warp-file)[ \t]*\n([\s\S]*?)\n```[ \t]*(?=\n|$)/gm;

/** Slot marker for block `i` —  never occurs in model output. */
export function richSlotMarker(i: number): string {
  return `RICH_SLOT_${i}`;
}

/** Matches any slot marker; capture group 1 is the block index. */
export const RICH_SLOT_RE = /RICH_SLOT_(\d+)/g;

export function extractRichBlocks(raw: string): {
  /** Prose with each extracted fence replaced by its slot marker. */
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
          break;
        case "warp-diff":
          blocks.push({ kind: "diff", payload: parsed as DiffPayload });
          break;
        case "warp-todos":
          blocks.push({ kind: "todos", payload: parsed as TodosPayload });
          break;
        case "warp-status":
          blocks.push({ kind: "status", payload: parsed as StatusPayload });
          break;
        case "warp-terminal":
          blocks.push({ kind: "terminal", payload: parsed as TerminalPayload });
          break;
        case "warp-command":
          blocks.push({ kind: "command", payload: parsed as CommandPayload });
          break;
        case "warp-callout":
          blocks.push({ kind: "callout", payload: parsed as CalloutPayload });
          break;
        case "warp-json":
          blocks.push({ kind: "json", payload: parsed as JsonPayload });
          break;
        case "warp-file":
          blocks.push({ kind: "file", payload: parsed as FilePayload });
          break;
        default:
          return "";
      }
      return richSlotMarker(blocks.length - 1);
    },
  );
  return { proseOnly: proseOnly.replace(/\n{3,}/g, "\n\n").trim(), blocks };
}
