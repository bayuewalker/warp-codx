"use client";

import { Fragment, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import "./message-content.css";
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

  // Run all four extractors against assistant messages. They are
  // orthogonal: ISSUE_DRAFT vs PR_ACTION vs TASK_COMPLETE vs the
  // fenced rich blocks. CMD may emit at most one of each per turn.
  const isAssistant = role === "assistant";
  const issueExtract = isAssistant
    ? extractIssueDraft(content)
    : { cleaned: content, draft: null };
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

  return (
    <div className={`message-content message-content--${roleClass}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre({ children }) {
            return <>{children}</>;
          },
          p({ children }) {
            return <p>{withInlinePills(children)}</p>;
          },
          li({ children }) {
            return <li>{withInlinePills(children)}</li>;
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
            // WARP/ui-fix-r2 — wrap the native <table> so wide
            // CMD-emitted tables (e.g. status reports) scroll
            // horizontally on narrow viewports instead of forcing
            // the bubble past the chat column.
            return (
              <div className="md-table-wrap">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {proseOnly}
      </ReactMarkdown>
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
