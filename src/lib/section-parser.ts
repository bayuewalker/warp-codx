/**
 * WARP/UI-PATTERN-DISPATCH — section-level type detector.
 *
 * Splits a markdown string on H2/H3 headings, detects the section
 * type from the heading emoji+keyword combination, and parses the
 * body into structured data ready for the typed React components
 * (DefTable / StatusTable / TodosBlock) in MessageContent.tsx.
 *
 * Only sections with at least one parsed data row are promoted to a
 * typed component; empty bodies fall back to plain prose so heading
 * text is still visible.
 */

export type SectionAccent = "teal" | "blue" | "amber";

export interface KVRow {
  key: string;
  val: string;
}

export interface StatusRow {
  file: string;
  signal: string;
}

export interface TodoItem {
  checked: boolean;
  text: string;
}

export type ParsedSection =
  | { kind: "prose"; markdown: string }
  | {
      kind: "def-table";
      accent: SectionAccent;
      icon: string;
      title: string;
      rows: KVRow[];
    }
  | {
      kind: "status-table";
      icon: string;
      title: string;
      rows: StatusRow[];
    }
  | { kind: "todos"; items: TodoItem[]; title: string }
  | { kind: "file-tree"; content: string; title: string };

/* ── Heading classifier ─────────────────────────────────────── */

interface Detection {
  kind: "def-table" | "status-table" | "todos" | "file-tree";
  accent?: SectionAccent;
  icon: string;
}

function classifyHeading(heading: string): Detection | null {
  const h = heading.toUpperCase();

  // File tree — check before 📋 to avoid ambiguity
  if (/📁/.test(heading) && /FILE[\s-]*TREE|REPO|STRUCTURE/.test(h)) {
    return { kind: "file-tree", icon: "📁" };
  }

  // Pattern F — ✅ + TODO / CHECKLIST / DONE / CRITERIA
  if (/✅/.test(heading) && /\b(TODO|CHECKLIST|DONE|CRITERIA|TASKS?)\b/.test(h)) {
    return { kind: "todos", icon: "✅" };
  }

  // Pattern B — 📋 + TABLE / STATUS / REGISTRY / COMPARISON
  if (
    /📋/.test(heading) &&
    /\b(TABLE|STATUS|REGISTRY|COMPARISON)\b/.test(h)
  ) {
    return { kind: "status-table", icon: "📋" };
  }

  // Pattern A amber — 🚨 or ⚠️ + DRIFT / ESCALATION / ALERT / WARNING
  if (
    /🚨|⚠️/.test(heading) &&
    /\b(DRIFT|ESCALATION|ALERT|WARNING)\b/.test(h)
  ) {
    return {
      kind: "def-table",
      accent: "amber",
      icon: heading.includes("🚨") ? "🚨" : "⚠️",
    };
  }

  // Pattern A blue — 📊 + SCORE / BREAKDOWN / METRICS / SENTINEL
  if (
    /📊/.test(heading) &&
    /\b(SCORE|BREAKDOWN|METRICS|SENTINEL)\b/.test(h)
  ) {
    return { kind: "def-table", accent: "blue", icon: "📊" };
  }

  // Pattern A blue — 🔀 + CHUNK / PLAN / TASKS
  if (/🔀/.test(heading) && /\b(CHUNK|PLAN|TASKS?)\b/.test(h)) {
    return { kind: "def-table", accent: "blue", icon: "🔀" };
  }

  // Pattern A teal — 📋 + OUTPUT / FORMAT / SUMMARY / REPORT / CHANGELOG / ENTRY
  // Must NOT also be TABLE / STATUS / REGISTRY / COMPARISON (caught above)
  if (
    /📋/.test(heading) &&
    /\b(OUTPUT|FORMAT|SUMMARY|REPORT|CHANGELOG|ENTRY)\b/.test(h)
  ) {
    return { kind: "def-table", accent: "teal", icon: "📋" };
  }

  return null;
}

/* ── Title extractor — strips leading emoji chars ───────────── */

const EMOJI_RE =
  /[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|⚠️|✅/gu;

function cleanTitle(raw: string): string {
  return raw.replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
}

/* ── Body parsers ───────────────────────────────────────────── */

/**
 * Pattern A — parse body lines into key/value rows.
 * Handles:
 *   - `**Key**: value` (markdown bold)
 *   - `Key: value`
 *   - `- Key: value`
 *   - `| Key | Value |` (GFM table row, skip separator)
 *   - Indented continuation lines appended to previous value.
 */
function parseKVBody(body: string): KVRow[] {
  const rows: KVRow[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;

    // GFM table separator — skip
    if (/^\|[-:| ]+\|$/.test(trimmed)) continue;

    // GFM table row: | key | val |
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const parts = trimmed
        .slice(1, -1)
        .split("|")
        .map((s) => s.trim());
      if (parts.length >= 2 && parts[0]) {
        rows.push({ key: stripBold(parts[0]), val: parts.slice(1).join(" | ") });
      }
      continue;
    }

    // Strip leading "- " or "* " list marker
    const stripped = trimmed.replace(/^[-*]\s+/, "");

    // Strip leading ** bold markdown key: **Key**: val  OR  **Key** | val
    const boldMatch = stripped.match(/^\*\*([^*]+)\*\*\s*[:|]\s*(.+)$/);
    if (boldMatch) {
      rows.push({ key: boldMatch[1].trim(), val: boldMatch[2].trim() });
      continue;
    }

    // Plain colon separator: Key: value
    const colonIdx = stripped.indexOf(":");
    const pipeIdx = stripped.indexOf(" | ");
    if (colonIdx > 0 && (pipeIdx < 0 || colonIdx < pipeIdx)) {
      const key = stripped.slice(0, colonIdx).trim();
      const val = stripped.slice(colonIdx + 1).trim();
      // Only accept if key looks like an identifier (no spaces beyond 2 words)
      if (key && val && key.split(/\s+/).length <= 5) {
        rows.push({ key: stripBold(key), val });
        continue;
      }
    }
    // Pipe separator: Key | value
    if (pipeIdx > 0) {
      const key = stripped.slice(0, pipeIdx).trim();
      const val = stripped.slice(pipeIdx + 3).trim();
      if (key && val) {
        rows.push({ key: stripBold(key), val });
        continue;
      }
    }

    // Continuation — append to previous value
    if (rows.length > 0 && /^\s/.test(line)) {
      rows[rows.length - 1].val += " " + trimmed;
    }
  }
  return rows;
}

/**
 * Pattern B — parse body into file/signal rows.
 * Accepts GFM table rows and colon-separated pairs.
 */
function parseStatusBody(body: string): StatusRow[] {
  const rows: StatusRow[] = [];
  for (const raw of body.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (/^\|[-:| ]+\|$/.test(trimmed)) continue; // separator

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const parts = trimmed
        .slice(1, -1)
        .split("|")
        .map((s) => s.trim());
      if (parts.length >= 2 && parts[0]) {
        rows.push({ file: parts[0], signal: parts.slice(1).join(" ") });
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      rows.push({
        file: trimmed.slice(0, colonIdx).trim(),
        signal: trimmed.slice(colonIdx + 1).trim(),
      });
    }
  }
  return rows;
}

/**
 * Pattern F — parse checkbox lines into TodoItem list.
 * Accepts GFM task-list syntax (- [ ] / - [x]) and bare [ ] / [x].
 */
function parseTodosBody(body: string): TodoItem[] {
  const items: TodoItem[] = [];
  for (const raw of body.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // - [ ] text  OR  - [x] text  OR  [ ] text  OR  [x] text
    const m = trimmed.match(/^(?:[-*]\s+)?[\[\(]\s*([xX✓✗\s])\s*[\]\)]\s*(.+)$/);
    if (m) {
      const checked = /[xX✓]/.test(m[1]);
      items.push({ checked, text: m[2].trim() });
    }
  }
  return items;
}

function stripBold(s: string): string {
  return s.replace(/\*\*/g, "").trim();
}

/* ── Public API ─────────────────────────────────────────────── */

/**
 * Split a markdown string into typed sections.
 * Heading lines (## / ###) are the section boundaries.
 * Sections whose body produces zero rows fall back to 'prose'.
 */
export function splitIntoSections(markdown: string): ParsedSection[] {
  const HEADING_RE = /^(#{2,3})\s+(.+)$/gm;
  const result: ParsedSection[] = [];

  const headings: Array<{ index: number; line: string; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = HEADING_RE.exec(markdown)) !== null) {
    headings.push({ index: m.index, line: m[0], text: m[2] });
  }

  if (headings.length === 0) {
    return markdown.trim() ? [{ kind: "prose", markdown }] : [];
  }

  // Content before first heading → always prose
  const beforeFirst = markdown.slice(0, headings[0].index);
  if (beforeFirst.trim()) {
    result.push({ kind: "prose", markdown: beforeFirst });
  }

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const bodyStart = h.index + h.line.length;
    const bodyEnd =
      i + 1 < headings.length ? headings[i + 1].index : markdown.length;
    const body = markdown.slice(bodyStart, bodyEnd);

    const detected = classifyHeading(h.text);

    if (!detected) {
      result.push({ kind: "prose", markdown: h.line + "\n" + body });
      continue;
    }

    const title = cleanTitle(h.text);
    const icon = detected.icon;

    switch (detected.kind) {
      case "file-tree": {
        // Prefer content inside a fenced block; fall back to raw body
        const fence = body.match(/```[\w]*\n?([\s\S]*?)```/);
        const content = fence ? fence[1] : body;
        if (content.trim()) {
          result.push({ kind: "file-tree", content: content.trimEnd(), title });
        } else {
          result.push({ kind: "prose", markdown: h.line + "\n" + body });
        }
        break;
      }
      case "todos": {
        const items = parseTodosBody(body);
        if (items.length > 0) {
          result.push({ kind: "todos", items, title });
        } else {
          result.push({ kind: "prose", markdown: h.line + "\n" + body });
        }
        break;
      }
      case "status-table": {
        const rows = parseStatusBody(body);
        if (rows.length > 0) {
          result.push({ kind: "status-table", icon, title, rows });
        } else {
          result.push({ kind: "prose", markdown: h.line + "\n" + body });
        }
        break;
      }
      case "def-table": {
        const rows = parseKVBody(body);
        if (rows.length > 0) {
          result.push({
            kind: "def-table",
            accent: detected.accent!,
            icon,
            title,
            rows,
          });
        } else {
          result.push({ kind: "prose", markdown: h.line + "\n" + body });
        }
        break;
      }
    }
  }

  return result;
}
