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

/* ─────────────────────────────────────────────────────────────────
   WARP/ui-polish — additional response-rendering block kinds. Same
   fenced-block contract as the blocks above (```warp-terminal /
   ```warp-command / ```warp-callout / ```warp-json / ```warp-file),
   extracted by `extractRichBlocks` and rendered as dedicated cards so
   the assistant never has to dump command output, JSON, or generated
   files into raw prose.
   ───────────────────────────────────────────────────────────────── */

/**
 * A single line inside a ```warp-terminal block. When `type` is omitted
 * the renderer auto-detects it from the leading glyph ($ → input,
 * ✓ → ok, ✕/✗ → err, ⚠ → warn) so the assistant can emit plain lines
 * and still get ANSI-style coloring for free.
 */
export type TerminalLineType = "in" | "out" | "ok" | "warn" | "err" | "dim";
export type TerminalLine = {
  /** Raw line text — leading whitespace preserved. */
  text: string;
  /** Optional explicit colour role; auto-detected from glyph when absent. */
  type?: TerminalLineType;
};

/** ```warp-terminal — dark terminal surface for command / build / test output. */
export type TerminalPayload = {
  /** Header label (default "TERMINAL"). */
  title?: string;
  /** Optional working-directory / host shown in the header. */
  cwd?: string;
  lines: TerminalLine[];
  /** Render a left gutter of line numbers. Defaults to false. */
  showLineNumbers?: boolean;
};

/** ```warp-command — one or more commands rendered apart from prose. */
export type CommandPayload = {
  /** Header label (default "COMMAND"). */
  title?: string;
  /** Each command on its own line. */
  commands: string[];
  /** Optional language hint for the badge (default "bash"). */
  lang?: string;
};

/** ```warp-callout — standardized SUCCESS / WARNING / ERROR / INFO card. */
export type CalloutKind = "success" | "warning" | "error" | "info";
export type CalloutPayload = {
  kind: CalloutKind;
  /** Bold lead line (defaults to the kind label, e.g. "Success"). */
  title?: string;
  /** Optional supporting line under the title. */
  text?: string;
};

/** ```warp-json — collapsible syntax-coloured JSON tree. */
export type JsonPayload = {
  /** Header label (default "JSON"). */
  title?: string;
  /** Arbitrary parsed JSON value to render as a tree. */
  data: unknown;
  /** Start collapsed (root closed). Defaults to false. */
  collapsed?: boolean;
};

/** ```warp-file — generated-file card with open / download / copy-path actions. */
export type FilePayload = {
  /** File name shown in the card, e.g. "REPORT.md". */
  name: string;
  /** Human-readable size, e.g. "12.4 KB". Computed from content when absent. */
  size?: string;
  /** Full repo/workspace path used by "Copy path". Falls back to `name`. */
  path?: string;
  /** File body — enables Open (preview), Download, and Copy actions. */
  content?: string;
  /** Extension/kind override (md/json/txt/yaml/csv). Derived from name when absent. */
  kind?: string;
};
