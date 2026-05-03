"use client";

import {
  Children,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
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
  DiffPayload,
  StatusPayload,
  TodosPayload,
} from "@/lib/types";

interface MessageContentProps {
  content: string;
  role: "user" | "assistant" | "system";
  /** Phase 3b — required for IssueCard.create POST. */
  sessionId?: string | null;
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
 * pulls every well-formed `warp-*` fence out of the raw markdown so
 * the rendered cluster can be wrapped in `<CollapsibleSection>` when
 * the count crosses the threshold. The remaining prose is fed to
 * ReactMarkdown unchanged; order is preserved.
 *
 * Why move blocks out of the markdown tree at all:
 *   - `<CollapsibleSection>` is a sibling wrapper; we cannot easily
 *     move ReactMarkdown-emitted children into a sibling wrapper
 *     after the fact.
 *   - The Replit-Agent collapsed-actions pattern in the spec puts
 *     all rich blocks together at the bottom when collapsed; pulling
 *     them out matches that mental model.
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
  }
}

// Phase 3c — `extractPRAction` lives in `src/lib/pr-action-extract.ts`
// so it can be unit-tested without standing up a JSX environment.

export default function MessageContent({
  content,
  role,
  sessionId = null,
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

  // Split the cleaned prose back on the placeholder markers so we
  // can interleave prose chunks with agent-reply badge cards.
  const SLOT_RE = /\u0001AGENT_SLOT_(\d+)\u0001/g;
  type RenderSeg =
    | { kind: "prose"; text: string }
    | { kind: "agent"; name: AgentReplyName; body: string };
  const renderSegs: RenderSeg[] = [];
  if (agentSegments.some((s) => s.kind === "agent")) {
    let last = 0;
    let m: RegExpExecArray | null;
    SLOT_RE.lastIndex = 0;
    while ((m = SLOT_RE.exec(proseOnly)) !== null) {
      const before = proseOnly.slice(last, m.index);
      if (before.trim().length > 0) {
        renderSegs.push({ kind: "prose", text: before });
      }
      const slot = proseSlots[Number(m[1])];
      if (slot && slot.kind === "agent" && slot.agentName && slot.agentBody !== undefined) {
        renderSegs.push({
          kind: "agent",
          name: slot.agentName,
          body: slot.agentBody,
        });
      }
      last = m.index + m[0].length;
    }
    const tail = proseOnly.slice(last);
    if (tail.trim().length > 0) {
      renderSegs.push({ kind: "prose", text: tail });
    }
  } else {
    renderSegs.push({ kind: "prose", text: proseOnly });
  }
  const draft = issueExtract.draft;
  const prAction = prExtract.action;
  const taskComplete = taskExtract.payload;
  const richBlocks = richExtract.blocks;

  // Build the ordered cluster of rich-block components that count
  // toward the collapsible threshold. TaskCompleteCard intentionally
  // sits OUTSIDE — it's the user-facing summary of the whole turn
  // and must always be visible.
  const clusterNodes: ReactNode[] = [];
  richBlocks.forEach((b, i) => {
    clusterNodes.push(renderRichBlock(b, i));
  });
  if (draft) {
    clusterNodes.push(
      <IssueCard key="issue-card" data={draft} sessionId={sessionId} />,
    );
  }
  if (prAction?.kind === "list") {
    clusterNodes.push(<PRListCard key="pr-list" sessionId={sessionId} />);
  } else if (prAction) {
    clusterNodes.push(
      <PRCard
        key="pr-card"
        prNumber={prAction.prNumber}
        initialIntent={prAction.kind as PRInitialIntent}
        sessionId={sessionId}
      />,
    );
  }

  const shouldCollapse = clusterNodes.length >= 2;

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
              <pre className="md-code-block">
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
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
    forge: "WARP\u2022FORGE",
    sentinel: "WARP\u2022SENTINEL",
    echo: "WARP\u2022ECHO",
  };

  return (
    <div className={`message-content message-content--${roleClass}`}>
      {renderSegs.map((seg, i) =>
        seg.kind === "prose" ? (
          <ReactMarkdown
            key={`p${i}`}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={mdComponents}
          >
            {seg.text}
          </ReactMarkdown>
        ) : (
          <div key={`a${i}`} className={`agent-reply agent-reply--${seg.name}`}>
            <div className="agent-reply-header">
              <span className={`agent-pill ${seg.name}`}>
                {AGENT_LABELS[seg.name]}
              </span>
            </div>
            <div className="agent-reply-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={mdComponents}
              >
                {seg.body}
              </ReactMarkdown>
            </div>
          </div>
        ),
      )}
      {shouldCollapse ? (
        <CollapsibleSection count={clusterNodes.length}>
          {clusterNodes.map((node, i) => (
            <Fragment key={i}>{node}</Fragment>
          ))}
        </CollapsibleSection>
      ) : (
        clusterNodes.map((node, i) => <Fragment key={i}>{node}</Fragment>)
      )}
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
            const badge = detectStatusBadge(nodeText(row[1]));
            return (
              <div className="md-table-status-row" key={i}>
                <dt className="md-table-status-key">{row[0]}</dt>
                <dd className="md-table-status-val">
                  {row[1] ?? ""}
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
