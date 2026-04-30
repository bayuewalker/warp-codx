// Phase 2 — directive composer templates.
//
// Pure client-side, no DB / API involvement. Each template knows the
// operator agent that will own the work; CMD reads the bracketed
// markdown produced by `format()` via SYSTEM_PROMPT v2 and emits the
// proper directive block.

export type TemplateType = "build" | "hotfix" | "review" | "report";

export interface TemplateField {
  name: string;
  label: string;
  type: "text" | "textarea" | "radio";
  required?: boolean;
  options?: string[];
  default?: string;
  placeholder?: string;
}

export interface TemplateDef {
  type: TemplateType;
  label: string;
  description: string;
  agent: string;
  fields: TemplateField[];
  format: (values: Record<string, string>) => string;
}

export const TEMPLATES: TemplateDef[] = [
  {
    type: "build",
    label: "Build",
    description: "New feature or code addition",
    agent: "WARP•FORGE",
    fields: [
      {
        name: "feature",
        label: "Feature",
        type: "textarea",
        required: true,
        placeholder: "What to build",
      },
      {
        name: "branch_hint",
        label: "Branch hint",
        type: "text",
        placeholder: "e.g. dashboard-ui (optional)",
      },
      {
        name: "scope",
        label: "Scope",
        type: "text",
        placeholder: "Files / surfaces (optional)",
      },
      {
        name: "acceptance",
        label: "Acceptance",
        type: "text",
        placeholder: "Success criterion (optional)",
      },
      {
        name: "priority",
        label: "Priority",
        type: "radio",
        options: ["low", "medium", "high"],
        default: "medium",
      },
    ],
    format: (v) => `[BUILD]
Feature: ${v.feature}
Branch hint: ${v.branch_hint || "auto"}
Scope: ${v.scope || "—"}
Acceptance: ${v.acceptance || "—"}
Priority: ${v.priority || "medium"}`,
  },
  {
    type: "hotfix",
    label: "Hotfix",
    description: "Bug fix or regression repair",
    agent: "WARP•FORGE",
    fields: [
      {
        name: "bug",
        label: "Bug",
        type: "textarea",
        required: true,
        placeholder: "What's broken, observable symptom",
      },
      {
        name: "surface",
        label: "Surface",
        type: "text",
        placeholder: "Where it appears (optional)",
      },
      {
        name: "severity",
        label: "Severity",
        type: "radio",
        options: ["low", "medium", "critical"],
        default: "medium",
      },
    ],
    format: (v) => `[HOTFIX]
Bug: ${v.bug}
Surface: ${v.surface || "—"}
Severity: ${v.severity || "medium"}`,
  },
  {
    type: "review",
    label: "Review",
    description: "Audit a branch or PR before merge",
    agent: "WARP•SENTINEL",
    fields: [
      {
        name: "target_ref",
        label: "Target",
        type: "text",
        required: true,
        placeholder: "Branch name or PR URL",
      },
      {
        name: "focus",
        label: "Focus",
        type: "textarea",
        placeholder: "Specific concerns (optional)",
      },
    ],
    format: (v) => `[REVIEW]
Target: ${v.target_ref}
Focus: ${v.focus || "general audit"}`,
  },
  {
    type: "report",
    label: "Report",
    description: "Status report or project update",
    agent: "WARP•ECHO",
    fields: [
      {
        name: "report_type",
        label: "Type",
        type: "radio",
        options: ["project_state", "branch_summary", "custom"],
        default: "project_state",
      },
      {
        name: "window",
        label: "Window",
        type: "text",
        placeholder: "Time range (optional)",
      },
      {
        name: "custom_prompt",
        label: "Custom prompt",
        type: "textarea",
        placeholder: "Only if type=custom",
      },
    ],
    format: (v) => `[REPORT]
Type: ${v.report_type || "project_state"}
Window: ${v.window || "since last report"}
Custom: ${v.custom_prompt || "—"}`,
  },
];

export function formatTemplateOutput(
  type: TemplateType,
  values: Record<string, string>,
): string {
  const def = TEMPLATES.find((t) => t.type === type);
  if (!def) return "";
  return def.format(values);
}
