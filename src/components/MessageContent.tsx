"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import "./message-content.css";

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
          // Strip the auto-wrapping <pre> so our `code` override fully owns the
          // block-level layout (needed for the directive card).
          pre({ children }) {
            return <>{children}</>;
          },
          // Intercept fenced code blocks to detect the `directive` language.
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const lang = match?.[1];
            // react-markdown v9 dropped the `inline` prop, so detect block
            // code two ways: (a) it has a `language-*` class (rehype-highlight
            // wrapped its children in highlighted spans), or (b) the raw text
            // contains a newline (unlabeled fenced blocks like ``` … ```).
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

            // Custom directive block — bordered "DISPATCH READY" card.
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

            // Default fenced code block (highlight.js handles syntax tokens
            // when the language is known; unlabeled blocks just render the
            // raw text in monospace inside the styled box).
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
