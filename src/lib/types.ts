export type Session = {
  id: string;
  label: string;
  created_at: string;
  updated_at: string;
};

export type MessageRole = "user" | "assistant" | "system";

export type Message = {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
};

/* ─────────────────────────────────────────────────────────────────
   Rich-block payload shapes — emitted by the assistant inside
   ```warp-action / ```warp-diff / ```warp-todos / ```warp-status
   fenced code blocks. The backend (Task #3) will start producing
   these; the renderers in src/components/blocks live here.
   ───────────────────────────────────────────────────────────────── */

/** ```warp-action — collapsible "Open Code"-style action card. */
export type ActionPayload = {
  /** One-line summary shown in the always-visible row. */
  summary: string;
  /** Optional file path or short identifier shown in mono in the body. */
  path?: string;
  /**
   * Human-readable detail text shown when expanded. May reference the path
   * with the literal token `{path}` which the renderer swaps into a styled
   * mono span.
   */
  detail?: string;
  /**
   * Optional small JSON-style strip rendered at the bottom (e.g. tool I/O).
   * Stored as an arbitrary object — the renderer JSON.stringifies it.
   */
  output?: unknown;
  /** Whether the card opens expanded by default. Defaults to true. */
  defaultOpen?: boolean;
};

/** A single hunk line inside a ```warp-diff. */
export type DiffLine = {
  /** Add / remove / context line. */
  type: "add" | "rem" | "ctx";
  /**
   * Line number to render in the gutter. Add lines may render the new
   * number; removed lines typically render "-"; context lines render their
   * original line number. Pass either a number or a short string.
   */
  num: number | string;
  /** Raw line text — leading whitespace is preserved. */
  text: string;
};

/** ```warp-diff — header + line-numbered hunks. */
export type DiffPayload = {
  /** Repo-relative file path shown in the header. */
  path: string;
  /** Optional pre-computed +N counter. If omitted, computed from `lines`. */
  added?: number;
  /** Optional pre-computed -N counter. If omitted, computed from `lines`. */
  removed?: number;
  lines: DiffLine[];
  /** Optional language hint for syntax coloring (e.g. "ts", "tsx", "js"). */
  language?: string;
};

/** A single todo inside a ```warp-todos. */
export type TodoItem = {
  /** Stable id (used as react key). Optional — falls back to index. */
  id?: string;
  /** Primary line of text. */
  text: string;
  /** Smaller mono subtext under the main line (e.g. "passed: …"). */
  subtext?: string;
  /** done = green check, active = spinner, idle = empty circle. */
  state: "done" | "active" | "idle";
};

/** ```warp-todos — TODOS x/y header + checklist. */
export type TodosPayload = {
  items: TodoItem[];
  /** Optional override for the `done` count; defaults to a count of done. */
  done?: number;
  /** Optional override for the `total`; defaults to items.length. */
  total?: number;
};

/** A row inside a ```warp-status. */
export type StatusRow = {
  /** Component / item name shown on the left. */
  name: string;
  /** Optional small mono note rendered next to the name. */
  note?: string;
  /** ok = green check; pending shows a dim outline; fail shows red. */
  state: "ok" | "pending" | "fail";
};

/** ```warp-status — striped table with status chips. */
export type StatusPayload = {
  /** Optional left header label (default "Component"). */
  nameHeader?: string;
  /** Optional right header label (default "Status"). */
  statusHeader?: string;
  rows: StatusRow[];
};
