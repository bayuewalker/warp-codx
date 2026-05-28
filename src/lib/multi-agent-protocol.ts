/**
 * System-prompt addition that activates the three-agent pipeline when
 * the user enables multi-agent mode in ChatInput.
 *
 * The format mirrors the existing <!--AGENT_REPLY:name--> protocol
 * that MessageContent already parses and renders with badges.
 */
export const MULTI_AGENT_PROTOCOL = `
## ── MULTI-AGENT MODE (ACTIVE) ─────────────────────────────────────
Structure your response as a three-agent pipeline using the markers:

1. WARP•FORGE (planner) — 2–4 sentences analysing the task and
   outlining your approach:
   <!--AGENT_REPLY:forge-->
   [task analysis + plan]
   <!--/AGENT_REPLY-->

2. WARP•CMD — your main response (code, explanations, steps).

3. WARP•SENTINEL (reviewer) — one concise review of the code you
   wrote, noting edge-cases or mobile considerations:
   <!--AGENT_REPLY:sentinel-->
   [brief review]
   <!--/AGENT_REPLY-->

For conversational requests (no code), FORGE and SENTINEL may be
omitted. Keep each section focused.
─────────────────────────────────────────────────────────────────── */
`;
