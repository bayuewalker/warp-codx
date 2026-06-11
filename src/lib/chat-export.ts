/**
 * Chat export/copy helpers.
 *
 * Turns a conversation into a portable Markdown transcript and provides
 * browser helpers to copy it to the clipboard or download it as a file. Kept
 * framework-free (pure string in/out) so the formatter is unit-testable; the
 * DOM helpers no-op safely on the server.
 */
import type { Message } from "./types";

const ROLE_LABEL: Record<string, string> = {
  user: "You",
  assistant: "WARP CodX",
  system: "System",
};

/** Slugify a session label into a safe filename stem. */
export function exportFilename(title: string | null | undefined): string {
  const stem = (title ?? "chat")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48) || "chat";
  const date = new Date().toISOString().slice(0, 10);
  return `warp-codx-${stem}-${date}.md`;
}

/**
 * Render a conversation as a Markdown transcript: a title, then one section per
 * turn labelled by speaker. Assistant content is already Markdown, so it's
 * emitted verbatim; user/system content is plain text.
 */
export function formatChatMarkdown(
  messages: Message[],
  title?: string | null,
): string {
  const lines: string[] = [`# ${title?.trim() || "WARP CodX chat"}`, ""];
  for (const m of messages) {
    const who = ROLE_LABEL[m.role] ?? m.role;
    lines.push(`## ${who}`, "", m.content.trim(), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** Copy text to the clipboard, with a legacy fallback. Resolves to success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to legacy path */
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

/** Trigger a client-side download of `content` as a file. No-ops on the server. */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/markdown;charset=utf-8",
): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ── Downloadable code/files from a single block ────────────────────────────

/** Map a fenced-block language tag to a file extension. */
const LANG_EXT: Record<string, string> = {
  javascript: "js", js: "js", typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx",
  python: "py", py: "py", bash: "sh", sh: "sh", shell: "sh", zsh: "sh",
  json: "json", yaml: "yml", yml: "yml", toml: "toml", html: "html", css: "css",
  scss: "scss", sql: "sql", go: "go", rust: "rs", rs: "rs", java: "java",
  kotlin: "kt", swift: "swift", ruby: "rb", rb: "rb", php: "php", c: "c",
  cpp: "cpp", csharp: "cs", cs: "cs", markdown: "md", md: "md", text: "txt",
  dockerfile: "Dockerfile", env: "env", xml: "xml", diff: "diff",
};

/** Extension for a language tag (defaults to `txt`). */
export function extForLang(lang: string | undefined): string {
  if (!lang) return "txt";
  return LANG_EXT[lang.toLowerCase()] ?? "txt";
}

/**
 * Derive a download filename for a code block. If the first line is a path-like
 * comment (`// src/foo.ts`, `# config.yaml`, `<!-- index.html -->`), use that
 * name so the agent can hand back a properly-named file; otherwise fall back to
 * `snippet.<ext>`.
 */
export function codeBlockFilename(
  lang: string | undefined,
  rawText: string,
): string {
  const firstLine = rawText.split("\n", 1)[0] ?? "";
  const m = firstLine.match(
    /^\s*(?:\/\/|#|<!--|\/\*|--)\s*(?:file:\s*)?([\w./-]+\.[A-Za-z0-9]+)/,
  );
  if (m && m[1]) {
    // Use just the basename — never write into a directory the browser picks.
    return m[1].split("/").pop()!;
  }
  return `snippet.${extForLang(lang)}`;
}
