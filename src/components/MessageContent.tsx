"use client";

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
import { withInlinePills } from "./blocks/InlinePills";
import type {
  ActionPayload,
  DiffPayload,
  StatusPayload,
  TodosPayload,
} from "@/lib/types";

interface MessageContentProps {
  content: string;
  role: "user" | "assistant" | "system";
}

export default function MessageContent({ content, role }: MessageContentProps) {
  const roleClass = role === "user" ? "user" : "assistant";
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
        }}
      >
        {content}
      </ReactMarkdown>
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
