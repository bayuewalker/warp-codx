"use client";

import {
  Children,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import CodeBlockWrapper from "./CodeBlockWrapper";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "./message-content.css";
import "./message-syntax.css";
import "./blocks/blocks.css";
import ActionCard from "./blocks/ActionCard";
import DiffBlock from "./blocks/DiffBlock";
import TodoBlock from "./blocks/TodoBlock";
import StatusTable from "./blocks/StatusTable";
import TerminalBlock from "./blocks/TerminalBlock";
import CommandBlock from "./blocks/CommandBlock";
import CalloutBlock from "./blocks/CalloutBlock";
import JsonBlock from "./blocks/JsonBlock";
import FileBlock from "./blocks/FileBlock";
import IssueCard, { type IssueDraftData } from "./IssueCard";
import PRCard, { type PRInitialIntent } from "./PRCard";
import PRListCard from "./PRListCard";
import CollapsibleSection from "./CollapsibleSection";
import TaskCompleteCard from "./TaskCompleteCard";
import { withInlinePills } from "./blocks/InlinePills";
import { extractPRAction } from "@/lib/pr-action-extract";
import { extractTaskComplete } from "@/lib/task-complete-extract";
import {
  extractRichBlocks,
  type RichBlockSpec,
} from "@/lib/rich-blocks-extract";
import {
  extractAgentReplies,
  type AgentName as AgentReplyName,
} from "@/lib/agent-reply-extract";
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
import { splitIntoSections } from "@/lib/section-parser";
import DefTable from "./sections/DefTable";
import SectionsStatusTable from "./sections/StatusTable";
import TodosBlock from "./sections/TodosBlock";
import sectionStyles from "./sections/sections.module.css";

interface MessageContentProps {
  content: string;
  role: "user" | "assistant" | "system";
  /** Phase 3b — required for IssueCard.create POST. */
  sessionId?: string | null;
  /** Active model short label (e.g. "Sonnet 4.6") for section/card header badges. */
  modelLabel?: string;
}

/**
 * Detect Phase 3b issue-draft markers in an assistant message.
 *
 * CMD emits, in order:
 *   <!--ISSUE_DRAFT_DATA {...JSON...}-->
 *   <!-- ISSUE_DRAFT: true -->
 *
 * Returns the parsed draft data + the markdown content with both
 * markers stripped, ready for the standard ReactMarkdown pipeline.
 * If only one of the markers is present the draft is treated as
 * malformed and BOTH markers are stripped without rendering a card.
 */
function extractIssueDraft(raw: string): {
  cleaned: string;
  draft: IssueDraftData | null;
} {
  const dataRe = /<!--\s*ISSUE_DRAFT_DATA\s+([\s\S]*?)-->/i;
  const markerRe = /<!--\s*ISSUE_DRAFT:\s*true\s*-->/i;
  const dataMatch = raw.match(dataRe);
  const markerMatch = raw.match(markerRe);
  if (!dataMatch || !markerMatch) {
    // If only one marker leaked through, strip it but render nothing.
    if (dataMatch || markerMatch) {
      return {
        cleaned: raw.replace(dataRe, "").replace(markerRe, "").trim(),
        draft: null,
      };
    }
    return { cleaned: raw, draft: null };
  }

  let draft: IssueDraftData | null = null;
  try {
    const parsed = JSON.parse(dataMatch[1].trim()) as Partial<IssueDraftData>;
    if (
      typeof parsed.title === "string" &&
      typeof parsed.body === "string" &&
      typeof parsed.branchSlug === "string" &&
      (parsed.validationTier === "MINOR" ||
        parsed.validationTier === "STANDARD" ||
        parsed.validationTier === "MAJOR") &&
      typeof parsed.objective === "string"
    ) {
      draft = {
        title: parsed.title,
        body: parsed.body,
        branchSlug: parsed.branchSlug,
        validationTier: parsed.validationTier,
        objective: parsed.objective,
      };
    }
  } catch {
    /* ignore — fall through with draft=null, markers stripped */
  }

  return {
    cleaned: raw.replace(dataRe, "").replace(markerRe, "").trim(),
    draft,
  };
}

/**
 * Phase 3.5 — `extractRichBlocks` lives in `src/lib/rich-blocks-extract.ts`
 * so it can be unit-tested without standing up a JSX environment. It
 * pulls every well-formed `warp-*` fence out of the raw markdown,
 * leaving a slot marker at each fence's position so the card mounts
 * exactly where the model placed it in the narration (Ona-style:
 * prose → action row → prose → diff → prose).
 *
 * Why move blocks out of the markdown tree at all:
 *   - `<CollapsibleSection>` wraps a consecutive RUN of 2+ blocks
 *     (design-ref Pattern D); we cannot group ReactMarkdown-emitted
 *     children into a sibling wrapper after the fact.
 *   - JSON payloads inside fences must never hit the markdown
 *     renderer (a malformed one would print raw JSON).
 *
 * The legacy inline `code` override below remains as a defensive
 * fallback — if a malformed fence slips past the regex it still
 * renders something rather than dumping JSON into the bubble.
 */
function renderRichBlock(spec: RichBlockSpec, key: number): ReactNode {
  switch (spec.kind) {
    case "action":
      return <ActionCard key={key} payload={spec.payload} />;
    case "diff":
      return <DiffBlock key={key} payload={spec.payload} />;
    case "todos":
      return <TodoBlock key={key} payload={spec.payload} />;
    case "status":
      return <StatusTable key={key} payload={spec.payload} />;
    case "terminal":
      return <TerminalBlock key={key} payload={spec.payload} />;
    case "command":
      return <CommandBlock key={key} payload={spec.payload} />;
    case "callout":
      return <CalloutBlock key={key} payload={spec.payload} />;
    case "json":
      return <JsonBlock key={key} payload={spec.payload} />;
    case "file":
      return <FileBlock key={key} payload={spec.payload} />;
  }
}

// Phase 3c — `extractPRAction` lives in `src/lib/pr-action-extract.ts`
// so it can be unit-tested without standing up a JSX environment.

/**
 * Markdown renderer config. References only module-level helpers (no
 * props/state), so it lives at module scope — a stable identity keeps
 * ReactMarkdown from re-running its component mapping on every
 * streamed chunk re-render.
 */
const mdComponents: Components = {
  pre({ children }) {
    return <>{children}</>;
  },
  p({ children }) {
    return <p>{withInlinePills(children)}</p>;
  },
  li({ children, className, ...props }) {
    // GFM task list — remark-gfm injects an input[type=checkbox]
    // as the first child of each task-list item. Replace it with
    // ☐ / ☑ so we control the visual on mobile (no native
    // disabled widget, consistent colour vs var(--warp-teal)).
    const arr = Children.toArray(children);
    const first = arr[0];
    if (
      isValidElement(first) &&
      first.type === "input" &&
      (first.props as { type?: string }).type === "checkbox"
    ) {
      const checked = Boolean(
        (first.props as { checked?: boolean }).checked,
      );
      return (
        <li
          className={`md-task-item${className ? ` ${className}` : ""}`}
          {...props}
        >
          <span
            className={`md-task-check ${checked ? "md-task-check--done" : "md-task-check--todo"}`}
            aria-hidden="true"
          >
            {checked ? "\u2611" : "\u2610"}
          </span>
          <span className="md-task-text">
            {withInlinePills(arr.slice(1) as ReactNode)}
          </span>
        </li>
      );
    }
    return (
      <li className={className} {...props}>
        {withInlinePills(children)}
      </li>
    );
  },
  strong({ children }) {
    return (
      <strong className="markdown-strong">
        {withInlinePills(children)}
      </strong>
    );
  },
  em({ children }) {
    return <em>{withInlinePills(children)}</em>;
  },
  code({ className, children, ...props }) {
    const match = /language-([^\s]+)/.exec(className || "");
    const lang = match?.[1];
    const rawText =
      typeof children === "string"
        ? children
        : Array.isArray(children)
          ? children
              .map((c) => (typeof c === "string" ? c : ""))
              .join("")
          : "";
    const isBlock = !!match || rawText.includes("\n");

    if (!isBlock) {
      return (
        <code className="md-inline-code" {...props}>
          {children}
        </code>
      );
    }

    // Defensive fallback — rich-block fences are normally
    // pre-extracted by `extractRichBlocks`. If a malformed one
    // slips through (e.g. broken closing fence), still render
    // something useful instead of leaking JSON.
    if (lang === "warp-action") {
      const payload = parseJson<ActionPayload>(rawText);
      if (payload) return <ActionCard payload={payload} />;
    }
    if (lang === "warp-diff") {
      const payload = parseJson<DiffPayload>(rawText);
      if (payload) return <DiffBlock payload={payload} />;
    }
    if (lang === "warp-todos") {
      const payload = parseJson<TodosPayload>(rawText);
      if (payload) return <TodoBlock payload={payload} />;
    }
    if (lang === "warp-status") {
      const payload = parseJson<StatusPayload>(rawText);
      if (payload) return <StatusTable payload={payload} />;
    }
    if (lang === "warp-terminal") {
      const payload = parseJson<TerminalPayload>(rawText);
      if (payload) return <TerminalBlock payload={payload} />;
    }
    if (lang === "warp-command") {
      const payload = parseJson<CommandPayload>(rawText);
      if (payload) return <CommandBlock payload={payload} />;
    }
    if (lang === "warp-callout") {
      const payload = parseJson<CalloutPayload>(rawText);
      if (payload) return <CalloutBlock payload={payload} />;
    }
    if (lang === "warp-json") {
      const payload = parseJson<JsonPayload>(rawText);
      if (payload) return <JsonBlock payload={payload} />;
    }
    if (lang === "warp-file") {
      const payload = parseJson<FilePayload>(rawText);
      if (payload) return <FileBlock payload={payload} />;
    }

    if (lang === "directive") {
      return (
        <div className="directive-block">
          <span className="directive-label">DISPATCH READY</span>
          <pre className="directive-pre">
            <code>{rawText.replace(/\n$/, "")}</code>
          </pre>
        </div>
      );
    }

    return (
      <CodeBlockWrapper lang={lang} rawText={rawText}>
        <code className={className} {...props}>
          {children}
        </code>
      </CodeBlockWrapper>
    );
  },
  a({ children, ...props }) {
    return (
      <a target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
  table({ children }) {
    // WARP/ui-fix-r3 — render markdown tables as a vertical
    // definition list (2-col → key/value pairs) or stacked
    // cards (3+ col), never as a horizontally scrolling
    // <table>. Mobile (375px) operators were losing the
    // right edge on every status report; vertical reflow
    // wraps freely and removes the need for swipe-to-scroll.
    return <MarkdownTable>{children}</MarkdownTable>;
  },
};

const AGENT_LABELS: Record<AgentReplyName, string> = {
  forge: "Planner",
  sentinel: "Reviewer",
  echo: "Reporter",
};

export default function MessageContent({
  content,
  role,
  sessionId = null,
  modelLabel,
}: MessageContentProps) {
  const roleClass = role === "user" ? "user" : "assistant";

  // Task #3 — pull operator-agent reply segments out FIRST. The
  // chat route streams agent stub responses wrapped in
  // <!--AGENT_REPLY:name-->...<!--/AGENT_REPLY-->. We render each
  // agent block inline with its own badge so the conversation reads
  // as: CMD prose → [FORGE reply] → CMD follow-up. The downstream
  // marker extractors (issue / PR / task / rich blocks) only ever
  // appear in CMD prose, so we re-stitch the prose pieces with
  // placeholders, run those extractors once on the combined text,
  // then split back on the placeholders for ordered rendering.
  const isAssistant = role === "assistant";
  const agentSegments = isAssistant
    ? extractAgentReplies(content)
    : [{ kind: "prose" as const, text: content }];

  const PROSE_PLACEHOLDER = (i: number) => `\u0001AGENT_SLOT_${i}\u0001`;
  const proseSlots: { kind: "prose" | "agent"; agentBody?: string; agentName?: AgentReplyName }[] = [];
  let combinedProse = "";
  agentSegments.forEach((seg, i) => {
    if (seg.kind === "prose") {
      combinedProse += seg.text;
      proseSlots.push({ kind: "prose" });
    } else {
      combinedProse += `\n\n${PROSE_PLACEHOLDER(i)}\n\n`;
      proseSlots.push({
        kind: "agent",
        agentBody: seg.body,
        agentName: seg.name,
      });
    }
  });

  const issueExtract = isAssistant
    ? extractIssueDraft(combinedProse)
    : { cleaned: combinedProse, draft: null };
  const prExtract = isAssistant
    ? extractPRAction(issueExtract.cleaned)
    : { cleaned: issueExtract.cleaned, action: null };
  const taskExtract = isAssistant
    ? extractTaskComplete(prExtract.cleaned)
    : { cleaned: prExtract.cleaned, payload: null };
  const richExtract = isAssistant
    ? extractRichBlocks(taskExtract.cleaned)
    : { proseOnly: taskExtract.cleaned, blocks: [] };

  const proseOnly = richExtract.proseOnly;
  const richBlocks = richExtract.blocks;

  // Split the cleaned prose back on BOTH placeholder families so each
  // card mounts exactly where its marker sat in the narration (the
  // Ona/agent-transcript pattern: prose → action row → prose → diff).
  //   - AGENT_SLOT_<i> → agent-reply badge card (index into proseSlots)
  //   - RICH_SLOT_<i>  → rich-block card (index into richBlocks)
  // Consecutive rich blocks with nothing but whitespace between them
  // merge into one `rich-run`, which collapses behind a single
  // <CollapsibleSection> when it holds 2+ blocks (design-ref Pattern D).
  const COMBINED_SLOT_RE = /\u0001(AGENT|RICH)_SLOT_(\d+)\u0001/g;
  type RenderSeg =
    | { kind: "prose"; text: string }
    | { kind: "agent"; name: AgentReplyName; body: string }
    | { kind: "rich-run"; indices: number[] };
  const renderSegs: RenderSeg[] = [];
  {
    let last = 0;
    let m: RegExpExecArray | null;
    COMBINED_SLOT_RE.lastIndex = 0;
    while ((m = COMBINED_SLOT_RE.exec(proseOnly)) !== null) {
      const before = proseOnly.slice(last, m.index);
      if (before.trim().length > 0) {
        renderSegs.push({ kind: "prose", text: before });
      }
      if (m[1] === "AGENT") {
        const slot = proseSlots[Number(m[2])];
        if (slot && slot.kind === "agent" && slot.agentName && slot.agentBody !== undefined) {
          renderSegs.push({
            kind: "agent",
            name: slot.agentName,
            body: slot.agentBody,
          });
        }
      } else {
        const idx = Number(m[2]);
        if (richBlocks[idx] !== undefined) {
          const prev = renderSegs[renderSegs.length - 1];
          // Whitespace-only prose between two rich slots was skipped
          // above, so a trailing rich-run means this block belongs to
          // the same consecutive burst — extend it.
          if (prev && prev.kind === "rich-run") {
            prev.indices.push(idx);
          } else {
            renderSegs.push({ kind: "rich-run", indices: [idx] });
          }
        }
      }
      last = m.index + m[0].length;
    }
    const tail = proseOnly.slice(last);
    if (tail.trim().length > 0) {
      renderSegs.push({ kind: "prose", text: tail });
    }
  }
  const draft = issueExtract.draft;
  const prAction = prExtract.action;
  const taskComplete = taskExtract.payload;

  // Interactive call-to-action cards (issue draft / PR action) mount
  // at the END of the message and are never collapsed — same rationale
  // as TaskCompleteCard: hiding a button the user must tap behind a
  // "Show" toggle hurts more than the saved scroll height.
  const ctaNodes: ReactNode[] = [];
  if (draft) {
    ctaNodes.push(
      <IssueCard key="issue-card" data={draft} sessionId={sessionId} />,
    );
  }
  if (prAction?.kind === "list") {
    ctaNodes.push(<PRListCard key="pr-list" sessionId={sessionId} />);
  } else if (prAction) {
    ctaNodes.push(
      <PRCard
        key="pr-card"
        prNumber={prAction.prNumber}
        initialIntent={prAction.kind as PRInitialIntent}
        sessionId={sessionId}
      />,
    );
  }

  /**
   * Render a prose string through the section-level dispatch pipeline.
   *
   * Each prose segment is split by H2/H3 headings whose emoji+keyword
   * pattern matches one of the typed section layouts (DefTable,
   * SectionsStatusTable, TodosBlock, file-tree <pre>). Sections that
   * don't match fall through to ReactMarkdown so all existing GFM
   * rendering (task-list items, inline code, fenced blocks, etc.)
   * is fully preserved.
   *
   */
  function renderProseContent(markdown: string, keyPrefix: string): ReactNode {
    // Guard: only run section splitting for assistant turns.
    // User/system content goes straight to ReactMarkdown.
    if (!isAssistant) {
      return (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={mdComponents}
        >
          {markdown}
        </ReactMarkdown>
      );
    }

    const sections = splitIntoSections(markdown);
    if (sections.length === 0) return null;

    // Single prose section — avoid an extra wrapper element.
    if (sections.length === 1 && sections[0].kind === "prose") {
      return (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={mdComponents}
        >
          {sections[0].markdown}
        </ReactMarkdown>
      );
    }

    return (
      <Fragment>
        {sections.map((sec, i) => {
          const k = `${keyPrefix}-s${i}`;
          switch (sec.kind) {
            case "def-table":
              return (
                <DefTable
                  key={k}
                  accent={sec.accent}
                  icon={sec.icon}
                  title={sec.title}
                  rows={sec.rows}
                  badge={modelLabel}
                />
              );
            case "status-table":
              return (
                <SectionsStatusTable
                  key={k}
                  icon={sec.icon}
                  title={sec.title}
                  rows={sec.rows}
                  badge={modelLabel}
                />
              );
            case "todos":
              return (
                <TodosBlock key={k} items={sec.items} title={sec.title} />
              );
            case "file-tree":
              return (
                <div key={k} className={sectionStyles.fileTree}>
                  <div className={sectionStyles.fileTreeHeader}>
                    <span className={sectionStyles.fileTreeTitle}>
                      📁 {sec.title || "FILE TREE"}
                    </span>
                    <span className={sectionStyles.fileTreeBadge}>
                      FILE TREE
                    </span>
                  </div>
                  <pre className={sectionStyles.fileTreePre}>
                    {sec.content}
                  </pre>
                </div>
              );
            case "prose":
            default:
              return (
                <ReactMarkdown
                  key={k}
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={mdComponents}
                >
                  {sec.markdown}
                </ReactMarkdown>
              );
          }
        })}
      </Fragment>
    );
  }


  return (
    <div className={`message-content message-content--${roleClass}`}>
      {renderSegs.map((seg, i) => {
        if (seg.kind === "prose") {
          return (
            <Fragment key={`p${i}`}>
              {renderProseContent(seg.text, `p${i}`)}
            </Fragment>
          );
        }
        if (seg.kind === "agent") {
          return (
            <div key={`a${i}`} className={`agent-reply agent-reply--${seg.name}`}>
              <div className="agent-reply-header">
                <span className={`agent-pill ${seg.name}`}>
                  {AGENT_LABELS[seg.name]}
                </span>
              </div>
              <div className="agent-reply-body">
                {renderProseContent(seg.body, `a${i}`)}
              </div>
            </div>
          );
        }
        // rich-run — a burst of consecutive rich blocks. 2+ collapse
        // behind one "Working — N actions" header (Pattern D); a lone
        // block renders directly in place.
        if (seg.indices.length >= 2) {
          return (
            <CollapsibleSection key={`r${i}`} count={seg.indices.length}>
              {seg.indices.map((idx) => (
                <Fragment key={idx}>
                  {renderRichBlock(richBlocks[idx], idx)}
                </Fragment>
              ))}
            </CollapsibleSection>
          );
        }
        return (
          <Fragment key={`r${i}`}>
            {renderRichBlock(richBlocks[seg.indices[0]], seg.indices[0])}
          </Fragment>
        );
      })}
      {ctaNodes}
      {taskComplete && <TaskCompleteCard payload={taskComplete} />}
    </div>
  );
}

function parseJson<T>(src: string): T | null {
  try {
    return JSON.parse(src.trim()) as T;
  } catch {
    return null;
  }
}

/**
 * Flatten a ReactNode tree into a plain string. We only need rough
 * text content for filename / badge-keyword detection, so we walk
 * children recursively and concatenate any string leaves. Non-string
 * leaves (icons, formatting wrappers without text, etc.) are skipped.
 */
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    return nodeText(el.props.children);
  }
  return "";
}

/**
 * Pattern B detection — a 2-col table is a "status table" when its
 * first column reads as filenames or short identifiers (e.g.
 * `PROJECT_STATE.md`, `src/lib/foo.ts`, `WORKTODO`). Heuristic:
 *   - non-empty body
 *   - every left-cell text is ≤ 64 chars, has no whitespace, contains
 *     a dot or slash (real filename / path evidence), and matches
 *     `[\w./-]+` so plain ALL_CAPS identifiers (API_VERSION,
 *     PR_NUMBER) stay in the Pattern A definition list.
 * If the table is empty we fall back to the plain key/value layout.
 */
function looksLikeStatusTable(rows: ReactNode[][]): boolean {
  if (rows.length === 0) return false;
  for (const row of rows) {
    const text = nodeText(row[0]).trim();
    if (!text) return false;
    if (text.length > 64) return false;
    if (/\s/.test(text)) return false;
    // Require concrete file/path evidence — a `.` or a `/`. Plain
    // ALL_CAPS identifiers (API_VERSION, RUN_MODE, PR_NUMBER) stay
    // in the Pattern A definition list; only paths and filenames
    // (PROJECT_STATE.md, src/lib/foo.ts) are promoted to Pattern B.
    if (!/[./]/.test(text)) return false;
    if (!/^[\w./-]+$/.test(text)) return false;
  }
  return true;
}

/**
 * Pattern B badge mapping — keyword scan over the right-cell text.
 * Order matters: ERROR / FAILED win over PENDING win over COMPLETE
 * so a row like "complete but pending re-check" reads as pending.
 */
function detectStatusBadge(
  text: string,
): { kind: "red" | "muted" | "green"; label: string } | null {
  const upper = text.toUpperCase();
  if (/\b(ERROR|FAILED|FAIL)\b/.test(upper)) {
    return { kind: "red", label: "ERROR" };
  }
  if (/\bPENDING\b/.test(upper) || /\bNOT READ\b/i.test(text)) {
    return { kind: "muted", label: "PENDING" };
  }
  if (/\b(COMPLETE|DONE)\b/.test(upper)) {
    return { kind: "green", label: "COMPLETE" };
  }
  return null;
}

/**
 * WARP/ui-fix-r3 — vertical-flow renderer for GFM markdown tables.
 *
 * react-markdown hands us the rendered children of `<table>` —
 * a `<thead>` containing one `<tr>` of `<th>` cells, and a
 * `<tbody>` of `<tr>` rows of `<td>` cells. We walk that tree
 * once to pull out:
 *   - `headers` — the label for each column (preserves inline
 *     react nodes like <code>, links, pills)
 *   - `rows` — each row's cells, in column order
 *
 * Then we pick a layout based on column count:
 *   - 2 columns → CSS-grid key/value list (left key bold, right
 *     value wraps freely). The header row renders once at the top
 *     in the same grid so "Field | Value" lines up with the data.
 *   - 3+ columns OR 0/1 columns → stacked cards, one card per
 *     row, each cell labelled with its column header above the
 *     value.
 *
 * No horizontal overflow in either layout — the grid / card
 * containers are 100% width and let long values wrap.
 */
function MarkdownTable({ children }: { children?: ReactNode }) {
  const headers: ReactNode[] = [];
  const rows: ReactNode[][] = [];

  Children.forEach(children, (section) => {
    if (!isValidElement(section)) return;
    const el = section as ReactElement<{ children?: ReactNode }>;
    const isThead = el.type === "thead";
    const isTbody = el.type === "tbody";
    if (!isThead && !isTbody) return;

    Children.forEach(el.props.children, (tr) => {
      if (!isValidElement(tr) || tr.type !== "tr") return;
      const trEl = tr as ReactElement<{ children?: ReactNode }>;
      const cells: ReactNode[] = [];
      Children.forEach(trEl.props.children, (cell) => {
        if (!isValidElement(cell)) return;
        const cellEl = cell as ReactElement<{ children?: ReactNode }>;
        if (cell.type !== "th" && cell.type !== "td") return;
        cells.push(cellEl.props.children);
      });
      if (isThead) {
        // GFM tables always have exactly one header row; use the
        // first one we see and ignore any stragglers.
        if (headers.length === 0) headers.push(...cells);
      } else {
        rows.push(cells);
      }
    });
  });

  // 2-column layouts. Two flavors:
  //   • Pattern B (status table) — first column looks like a filename
  //     or short identifier (e.g. PROJECT_STATE.md, src/foo.ts). Render
  //     the key in mono + warp-blue at a fixed 44% width and append a
  //     status badge to the value when keywords (COMPLETE / PENDING /
  //     ERROR) appear in the cell text.
  //   • Pattern A (definition list) — anything else. 38% fixed key
  //     column in semibold dim text, value wraps freely.
  if (headers.length === 2) {
    if (looksLikeStatusTable(rows)) {
      return (
        <dl className="md-table-status">
          <div className="md-table-status-row md-table-status-row--header">
            <dt className="md-table-status-key">{headers[0]}</dt>
            <dd className="md-table-status-val">{headers[1]}</dd>
          </div>
          {rows.map((row, i) => {
            const rawText = nodeText(row[1]);
            const badge = detectStatusBadge(rawText);
            // Strip the matching badge keyword from the cell text so we
            // don't render "COMPLETE COMPLETE" / "PENDING PENDING" — the
            // badge already conveys the state, the prose carries the
            // remaining context. When the cell is *only* the keyword,
            // residual text is empty and only the badge shows.
            const residualText = badge
              ? rawText
                  .replace(
                    /\b(COMPLETE|DONE|PENDING|NOT READ|ERROR|FAILED?|FAIL)\b/gi,
                    "",
                  )
                  .trim()
                  .replace(/\s{2,}/g, " ")
              : null;
            const hideOriginal = badge && residualText === "";
            return (
              <div className="md-table-status-row" key={i}>
                <dt className="md-table-status-key">{row[0]}</dt>
                <dd className="md-table-status-val">
                  {!hideOriginal && (residualText ?? row[1] ?? "")}
                  {badge && (
                    <span className={`md-table-badge md-table-badge--${badge.kind}`}>
                      {badge.label}
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      );
    }
    return (
      <dl className="md-table-kv">
        <div className="md-table-kv-row md-table-kv-row--header">
          <dt className="md-table-kv-key">{headers[0]}</dt>
          <dd className="md-table-kv-val">{headers[1]}</dd>
        </div>
        {rows.map((row, i) => (
          <div className="md-table-kv-row" key={i}>
            <dt className="md-table-kv-key">{row[0]}</dt>
            <dd className="md-table-kv-val">{row[1] ?? ""}</dd>
          </div>
        ))}
      </dl>
    );
  }

  // 3+ column (or 0/1 — same fallback) stacked-cards layout.
  return (
    <div className="md-table-cards">
      {rows.map((row, i) => (
        <div className="md-table-card" key={i}>
          {row.map((cell, j) => (
            <div className="md-table-card-row" key={j}>
              {headers[j] !== undefined ? (
                <div className="md-table-card-label">{headers[j]}</div>
              ) : null}
              <div className="md-table-card-value">{cell}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
