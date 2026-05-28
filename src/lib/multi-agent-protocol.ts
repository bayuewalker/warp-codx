/**
 * System-prompt addition that activates the three-agent pipeline when
 * the user enables multi-agent mode in ChatInput.
 *
 * The format mirrors the existing <!--AGENT_REPLY:name--> protocol
 * that MessageContent already parses and renders with badges.
 */
export const MULTI_AGENT_PROTOCOL = `
## ── MULTI-AGENT MODE (ACTIVE) ─────────────────────────────────────
Structure your response as a three-step pipeline using the markers:

1. Planner — 2–4 sentences analysing the task and outlining approach:
   <!--AGENT_REPLY:forge-->
   [task analysis + plan]
   <!--/AGENT_REPLY-->

2. Your main response (code, explanations, steps).

3. Reviewer — one concise review of the code, noting edge-cases or
   mobile considerations:
   <!--AGENT_REPLY:sentinel-->
   [brief review]
   <!--/AGENT_REPLY-->

For conversational requests (no code), planner and reviewer may be
omitted. Keep each section focused.
─────────────────────────────────────────────────────────────────── */
`;
