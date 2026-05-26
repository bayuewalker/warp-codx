/**
 * Extracts agent reply blocks from an assistant message.
 *
 * The chat route may wrap sub-agent responses in HTML comment markers:
 *   <!--AGENT_REPLY:forge-->...body...<!--/AGENT_REPLY-->
 *
 * This module splits the raw content into an ordered list of prose and
 * agent segments so MessageContent can render each with its own badge.
 */

export type AgentName = "forge" | "sentinel" | "echo";

type ProseSegment = { kind: "prose"; text: string };
type AgentSegment = { kind: "agent"; name: AgentName; body: string };
export type ReplySegment = ProseSegment | AgentSegment;

const AGENT_RE =
  /<!--AGENT_REPLY:(forge|sentinel|echo)-->([\s\S]*?)<!--\/AGENT_REPLY-->/g;

export function extractAgentReplies(content: string): ReplySegment[] {
  const segments: ReplySegment[] = [];
  let lastIndex = 0;
  AGENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = AGENT_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "prose", text: content.slice(lastIndex, match.index) });
    }
    segments.push({
      kind: "agent",
      name: match[1] as AgentName,
      body: match[2].trim(),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ kind: "prose", text: content.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ kind: "prose", text: content }];
}
