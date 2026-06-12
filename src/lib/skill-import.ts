/**
 * Install a skill from a GitHub link.
 *
 * Accepts a direct link to a SKILL.md / *.md file and returns its raw markdown
 * so the existing `createSkillFromMarkdown` path can install it. Only GitHub
 * hosts are allowed — this is a server-side fetch, so the host allowlist keeps
 * it from being turned into an SSRF probe against internal services.
 */
import { MAX_SKILL_CONTENT } from "./skills";

/** Hosts we'll fetch skill markdown from. */
const ALLOWED_HOSTS = new Set([
  "github.com",
  "raw.githubusercontent.com",
  "gist.github.com",
  "gist.githubusercontent.com",
]);

/** A little headroom over the body cap for frontmatter + trimming. */
const MAX_FETCH_BYTES = MAX_SKILL_CONTENT + 8 * 1024;
const TIMEOUT_MS = 8000;

/**
 * Normalize a GitHub URL to its raw form:
 *   github.com/<o>/<r>/blob/<ref>/<path>  → raw.githubusercontent.com/<o>/<r>/<ref>/<path>
 *   gist.github.com/<u>/<id>              → gist.github.com/<u>/<id>/raw
 * Raw URLs (and anything already raw) pass through unchanged. Throws on a
 * non-GitHub host or an obviously non-markdown target.
 */
export function toRawGitHubUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new Error("Not a valid URL.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("URL must be http(s).");
  }
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error("Only GitHub links are supported.");
  }

  // github.com/<owner>/<repo>/blob/<ref>/<path...> → raw.githubusercontent.com
  if (host === "github.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    const blobIdx = parts.indexOf("blob");
    if (blobIdx === -1 || parts.length < blobIdx + 3) {
      throw new Error(
        "Link a specific file (…/blob/<branch>/<path>/SKILL.md) or a raw URL.",
      );
    }
    const owner = parts[0];
    const repo = parts[1];
    const rest = parts.slice(blobIdx + 1).join("/"); // <ref>/<path...>
    return `https://raw.githubusercontent.com/${owner}/${repo}/${rest}`;
  }

  // Gist page → append /raw to grab the file body.
  if (host === "gist.github.com" && !u.pathname.endsWith("/raw")) {
    return `https://gist.github.com${u.pathname.replace(/\/$/, "")}/raw`;
  }

  return u.toString();
}

/**
 * Fetch raw skill markdown from a GitHub link. Resolves the raw URL, enforces a
 * timeout + size cap, and returns the text. Never follows the request to a
 * non-GitHub host.
 */
export async function fetchSkillMarkdownFromUrl(input: string): Promise<string> {
  const raw = toRawGitHubUrl(input);
  let res: Response;
  try {
    res = await fetch(raw, {
      method: "GET",
      headers: { Accept: "text/plain, text/markdown, */*" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error("Fetch timed out.");
    }
    throw new Error("Could not reach the URL.");
  }
  if (!res.ok) {
    throw new Error(`Fetch failed (HTTP ${res.status}). Is the link public?`);
  }
  // Final-URL host re-check in case a redirect left GitHub.
  try {
    const finalHost = new URL(res.url).hostname.toLowerCase();
    if (!ALLOWED_HOSTS.has(finalHost)) {
      throw new Error("Redirected off GitHub — refusing to fetch.");
    }
  } catch {
    /* res.url is always set in practice; ignore parse hiccups */
  }

  const text = await res.text();
  if (!text.trim()) throw new Error("The file is empty.");
  if (text.length > MAX_FETCH_BYTES) {
    throw new Error("File too large to install as a skill.");
  }
  return text;
}

/* ─────────────────────────────────────────────────────────────────
   Repo-source install — "owner/repo" + skill name (the Add form in
   Settings → Skills). We don't know the repo's layout, so probe the
   well-known places a SKILL.md lives, on the default branches.
   ───────────────────────────────────────────────────────────────── */

const SOURCE_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const NAME_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Candidate raw URLs for `<owner>/<repo>` + `<name>`, most-specific first.
 * Exported for unit tests.
 */
export function buildRepoCandidates(source: string, name: string): string[] {
  const paths = [
    `skills/${name}/SKILL.md`,
    `${name}/SKILL.md`,
    `.claude/skills/${name}/SKILL.md`,
    `skills/${name}.md`,
    `${name}.md`,
  ];
  const urls: string[] = [];
  for (const branch of ["main", "master"]) {
    for (const p of paths) {
      urls.push(`https://raw.githubusercontent.com/${source}/${branch}/${p}`);
    }
  }
  return urls;
}

/**
 * Fetch skill markdown given a GitHub repo source ("owner/repo") and a skill
 * name. Tries the candidate layouts in order and returns the first hit;
 * throws with the probed locations when nothing matches.
 */
export async function fetchSkillMarkdownFromRepo(
  source: string,
  name: string,
): Promise<string> {
  const src = source.trim().replace(/^github\.com\//i, "");
  const skill = name.trim();
  if (!SOURCE_RE.test(src)) {
    throw new Error('Repository source must look like "owner/repo".');
  }
  if (!NAME_RE.test(skill)) {
    throw new Error("Skill name may only contain letters, digits, ., _ and -.");
  }

  for (const url of buildRepoCandidates(src, skill)) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { Accept: "text/plain, text/markdown, */*" },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      continue; // timeout / network — try the next layout
    }
    if (!res.ok) continue;
    const text = await res.text();
    if (!text.trim()) continue;
    if (text.length > MAX_FETCH_BYTES) {
      throw new Error("File too large to install as a skill.");
    }
    return text;
  }
  throw new Error(
    `No SKILL.md found for "${skill}" in ${src} — looked in skills/${skill}/, ${skill}/, .claude/skills/${skill}/ on main and master.`,
  );
}
