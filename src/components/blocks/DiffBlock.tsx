"use client";

import { useCallback, useMemo, useState } from "react";
import type { DiffLine, DiffPayload } from "@/lib/types";
import CollapsibleBlock from "./CollapsibleBlock";
import { copyToClipboard } from "@/lib/chat-export";

type Props = {
  payload: DiffPayload;
};

/** Build a unified-diff patch string (`+`/`-`/` ` prefixed) for copy. */
function toUnifiedPatch(payload: DiffPayload): string {
  const head = `--- a/${payload.path}\n+++ b/${payload.path}`;
  const body = payload.lines
    .map((l) => {
      const prefix = l.type === "add" ? "+" : l.type === "rem" ? "-" : " ";
      return prefix + l.text;
    })
    .join("\n");
  return `${head}\n${body}\n`;
}

export default function DiffBlock({ payload }: Props) {
  const added =
    payload.added ?? payload.lines.filter((l) => l.type === "add").length;
  const removed =
    payload.removed ?? payload.lines.filter((l) => l.type === "rem").length;

  // Diffs render expanded by default — they're the primary content of a
  // turn. When part of a 2+ block cluster the outer CollapsibleSection
  // ("Working — N actions") still hides them until the row is opened.
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const patch = useMemo(() => toUnifiedPatch(payload), [payload]);
  const handleCopyPatch = useCallback(() => {
    copyToClipboard(patch).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [patch]);

  const header = (
    <>
      <span className="diff-icon" aria-hidden="true">
        ‹›
      </span>
      <span className="diff-path">{payload.path}</span>
    </>
  );

  const pill = (
    <span className="diff-stats">
      <span className="add">+{added}</span>
      <span className="rem">−{removed}</span>
    </span>
  );

  return (
    <CollapsibleBlock
      className="diff-block"
      headerClassName="block-summary diff-header"
      header={header}
      pill={pill}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <div className="diff-toolbar">
        <span className="diff-toolbar-stats">
          <span className="add">+{added}</span>
          <span className="rem">−{removed}</span>
        </span>
        <button
          type="button"
          className="diff-copy"
          onClick={handleCopyPatch}
        >
          {copied ? "✓ Copied" : "Copy patch"}
        </button>
      </div>
      <div className="diff-content">
        {payload.lines.map((line, i) => (
          <DiffRow key={i} line={line} />
        ))}
      </div>
    </CollapsibleBlock>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  const cls =
    line.type === "add"
      ? "diff-line add"
      : line.type === "rem"
        ? "diff-line rem"
        : "diff-line";

  const gutter =
    line.type === "add"
      ? line.num === undefined || line.num === "+"
        ? "+"
        : String(line.num)
      : line.type === "rem"
        ? "-"
        : String(line.num ?? "");

  return (
    <div className={cls}>
      <span className="lnum">{gutter}</span>
      <span className="lcontent">
        <Tokenized text={line.text} />
      </span>
    </div>
  );
}


const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "do", "break", "continue", "switch", "case", "default", "try", "catch",
  "finally", "throw", "new", "this", "class", "extends", "super", "import",
  "export", "from", "as", "async", "await", "typeof", "instanceof", "in",
  "of", "void", "delete", "yield", "true", "false", "null", "undefined",
  "interface", "type", "enum", "implements", "public", "private", "protected",
  "readonly", "static", "abstract",
]);

type Tok = { c: string; t?: "kw" | "str" | "com" | "num" | "var" | "fn" };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const N = src.length;
  while (i < N) {
    const ch = src[i];

    // Line comment
    if (ch === "/" && src[i + 1] === "/") {
      out.push({ c: src.slice(i), t: "com" });
      break;
    }
    // String (single, double, backtick) — naive, no escape recursion.
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      let j = i + 1;
      while (j < N) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === q) { j += 1; break; }
        j += 1;
      }
      out.push({ c: src.slice(i, j), t: "str" });
      i = j;
      continue;
    }
    // Number
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < N && /[0-9._eE]/.test(src[j])) j += 1;
      out.push({ c: src.slice(i, j), t: "num" });
      i = j;
      continue;
    }
    // Identifier — keyword / function call / variable
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < N && /[A-Za-z0-9_$]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      // Skip whitespace to detect "(": function call?
      let k = j;
      while (k < N && (src[k] === " " || src[k] === "\t")) k += 1;
      const isCall = src[k] === "(";
      let t: Tok["t"] | undefined;
      if (KEYWORDS.has(word)) t = "kw";
      else if (isCall) t = "fn";
      else if (/^[A-Z]/.test(word)) t = "fn"; // constructor-ish
      else t = "var";
      out.push({ c: word, t });
      i = j;
      continue;
    }
    // Anything else — emit as plain.
    out.push({ c: ch });
    i += 1;
  }
  return out;
}

function Tokenized({ text }: { text: string }) {
  const toks = tokenize(text);
  return (
    <>
      {toks.map((tok, i) =>
        tok.t ? (
          <span key={i} className={`syn-${tok.t}`}>
            {tok.c}
          </span>
        ) : (
          <span key={i}>{tok.c}</span>
        ),
      )}
    </>
  );
}
