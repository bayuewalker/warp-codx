/**
 * Agent access gate — decides whether a user may launch a coding-agent run.
 *
 * Abstracted so Phase C (tiered access: pro → allowed, free → upgrade prompt)
 * can swap in logic here without touching any call sites.
 *
 * Phase A policy: admin-only.
 */
import type { AuthedUser } from "@/lib/roles";

export type AccessResult =
  | { allowed: true }
  | { allowed: false; reason: string; upgradeRequired?: boolean };

/**
 * Returns `{ allowed: true }` when the user may start a new coding-agent run,
 * or `{ allowed: false, reason }` when they may not.
 */
export function canLaunchCodingAgent(user: AuthedUser): AccessResult {
  if (user.role === "admin") return { allowed: true };
  return {
    allowed: false,
    reason: "Coding agent is currently available to admins only.",
  };
}
