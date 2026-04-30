"use client";

import type { DiffLine, DiffPayload } from "@/lib/types";

type Props = {
  payload: DiffPayload;
};

export default function DiffBlock({ payload }: Props) {
  const added =
    payload.added ?? payload.lines.filter((l) => l.type === "add").length;
  const removed =
    payload.removed ?? payload.lines.filter((l) => l.type === "rem").length;

  return (
    <div className="diff-block">
      <div className="diff-header">
        <span className="diff-icon" aria-hidden="true">
          ‹›
        </span>
        <span className="diff-path">{payload.path}</span>
        <span className="diff-stats">
          <span className="add">+{added}</span>
          <span className="rem">-{removed}</span>
        </span>
      </div>
      <div className="diff-content">
        {payload.lines.map((line, i) => (
          <DiffRow key={i} line={line} />
        ))}
      </div>
    </div>
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
