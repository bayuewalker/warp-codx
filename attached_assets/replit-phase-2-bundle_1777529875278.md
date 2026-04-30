**Phase 2 Bundle** — two complementary changes in one dispatch:
- **Part 1:** Update WARP🔹CMD's SYSTEM_PROMPT (single const swap, ~5 min)
- **Part 2:** Phase 2 directive templates (forms-based dispatch composer, ~3-4 hours)

Execute Part 1 first, verify CMD persona output, then proceed to Part 2.

⚠️ **PREREQUISITE:** Phase 1.5d (design migration) must be merged and verified before this bundle starts. Phase 1.5d touches the input area component, and Phase 2 (Part 2) builds on top of that input area structure. Confirm 1.5d is done before executing this bundle.

═══════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════
PART 1 — SYSTEM_PROMPT v2 for WARP🔹CMD
═══════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════

**File to edit:** `src/app/api/chat/route.ts`
**Action:** Replace the existing `SYSTEM_PROMPT` const with the version below.

═══════════════════════════════════════════════════════════
THE NEW CONST
═══════════════════════════════════════════════════════════

```typescript
const SYSTEM_PROMPT = `You are WARP🔹CMD — the Commander agent of WalkerMind OS, reporting to Mr. Walker (BayueWalker, founder).

## Role
Receive directives from Mr. Walker. Decide:
1. Whether the task is dispatch-ready or needs one clarifying question first
2. Which operator agent owns execution
3. The exact directive block to emit

## Operator Roster
- **WARP•FORGE** — builder. Code, branches, file edits, PRs. Default for any build/code/feature task.
- **WARP•SENTINEL** — validator. Audits MAJOR FORGE work before merge. Engage when scope touches: auth, database schema, payments, public-facing surfaces, or >5 files.
- **WARP•ECHO** — reporter. HTML reports, PROJECT_STATE.md updates, branch activity summaries.

## Brand Rules (strict)
- Branch format: \`WARP/{feature-slug}\` — lowercase, hyphen-separated only. NO dots, NO underscores, NO date suffix.
  - ✅ \`WARP/dashboard-ui\` · \`WARP/risk-circuit\` · \`WARP/sidebar-mobile-fix\`
  - ❌ \`WARP/dashboard_ui\` · \`WARP/fix-2026-04-30\` · \`WARP/test.phase.1.5\`
- Agent symbols: WARP🔹CMD (director, blue diamond, you). WARP•FORGE / WARP•SENTINEL / WARP•ECHO (operators, bullet).
- Repo: github.com/bayuewalker/walkermind-os

## Directive Block Format
When a task is dispatch-ready, emit a fenced code block with language \`directive\`:

\`\`\`directive
TARGET: WARP•FORGE
TASK: <one-line build/edit/review/report action>
BRANCH: WARP/<feature-slug>
SCOPE: <files or surfaces touched>
ACCEPTANCE: <observable success criterion>
PRIORITY: low | medium | high
\`\`\`

Rules:
- One agent per directive block. Never combine.
- TARGET, TASK, BRANCH are mandatory. SCOPE / ACCEPTANCE / PRIORITY recommended for non-trivial tasks.
- If the task is unclear or missing info, DO NOT emit a directive block. Ask exactly one specific clarifying question.

## Language
- Mirror Mr. Walker's input language. Bahasa Indonesia by default. English when he writes English.
- Inside directive blocks, all content is always English (TASK, BRANCH, SCOPE, etc.).

## Tone
- Sharp technical lead talking to a founder. Direct. No filler.
- Skip ceremonial preamble. Don't write "Certainly!", "Here's the structured directive...", "I'd be happy to help..." — go straight to the point.
- State risks directly when relevant.

## Anti-patterns
- No multi-agent directives in one block.
- No date suffixes in branches.
- No ceremonial preamble before the directive block.
- No invented feature slugs for ambiguous requests — ask first.`
```

═══════════════════════════════════════════════════════════
PART 1 VERIFICATION
═══════════════════════════════════════════════════════════

After saving, send this test message in a new session:

> "Bro tolong dispatch perbaikan sidebar di Crusader yang overlap di mobile"

Expected output:
- Brief acknowledgment in Bahasa Indonesia (mirrors Mr. Walker's language)
- NO ceremonial preamble (no "Certainly", "Here's the directive", "Sure thing")
- Directive block with:
  - `TARGET: WARP•FORGE`
  - `TASK:` (English, one-line, action-oriented)
  - `BRANCH: WARP/sidebar-mobile-overlap-fix` or similar — must be lowercase, hyphens only, NO dots, NO date suffix
  - `SCOPE` and `ACCEPTANCE` if context allows

If output still has ceremonial preamble or wrong branch format, the const wasn't saved correctly.

═══════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════
PART 2 — Phase 2 Directive Templates
═══════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════

Forms-based directive composer. User taps templates icon, fills structured fields, the composed markdown is dropped into the chat textarea (not auto-sent), then sent to CMD which emits a directive block.

Four template types: **Build · Hotfix · Review · Report**, each pre-routed to its target agent.

═══════════════════════════════════════════════════════════
GOAL
═══════════════════════════════════════════════════════════

- Force structured input on mobile (forms > free-form typing)
- Pre-fill agent routing (template knows which agent owns it)
- Faster mobile UX, consistent vocabulary
- CMD remains the brain — templates are scaffolds, not the directive itself

═══════════════════════════════════════════════════════════
UX FLOW
═══════════════════════════════════════════════════════════

1. User taps templates icon (left of model chip in input meta row)
2. Bottom sheet slides up: 4 template cards (Build / Hotfix / Review / Report)
3. User taps one, e.g. **Build**
4. Form view replaces template list, with fields specific to that template type
5. User fills required fields, taps **Compose**
6. Bottom sheet closes; structured markdown is dropped into the textarea (NOT auto-sent — user reviews and taps Send)
7. CMD reads structured input → emits directive block

═══════════════════════════════════════════════════════════
TEMPLATE DEFINITIONS
═══════════════════════════════════════════════════════════

## Template 1: BUILD
**Auto-target:** WARP•FORGE
**Use case:** New feature, refactor, code addition

Fields:
- `feature` — textarea, required, "What to build"
- `branch_hint` — text, optional, "e.g. dashboard-ui (optional)"
- `scope` — text, optional, "Files / surfaces"
- `acceptance` — text, optional, "Success criterion"
- `priority` — radio: low | medium | high (default medium)

Output:
```
[BUILD]
Feature: {feature}
Branch hint: {branch_hint or "auto"}
Scope: {scope or "—"}
Acceptance: {acceptance or "—"}
Priority: {priority}
```

## Template 2: HOTFIX
**Auto-target:** WARP•FORGE
**Use case:** Bug fix, regression repair

Fields:
- `bug` — textarea, required, "What's broken, observable symptom"
- `surface` — text, optional, "Where it appears"
- `severity` — radio: low | medium | critical (default medium)

Output:
```
[HOTFIX]
Bug: {bug}
Surface: {surface or "—"}
Severity: {severity}
```

## Template 3: REVIEW
**Auto-target:** WARP•SENTINEL
**Use case:** Audit a branch or PR before merge

Fields:
- `target_ref` — text, required, "Branch name or PR URL"
- `focus` — textarea, optional, "Specific concerns (e.g. auth flow, RLS)"

Output:
```
[REVIEW]
Target: {target_ref}
Focus: {focus or "general audit"}
```

## Template 4: REPORT
**Auto-target:** WARP•ECHO
**Use case:** Status reports, project updates

Fields:
- `report_type` — radio: project_state | branch_summary | custom (default project_state)
- `window` — text, optional, "Time range" (default "since last report")
- `custom_prompt` — textarea, only visible if type=custom

Output:
```
[REPORT]
Type: {report_type}
Window: {window}
Custom: {custom_prompt or "—"}
```

═══════════════════════════════════════════════════════════
ARCHITECTURE
═══════════════════════════════════════════════════════════

- **Templates are pure client-side.** No DB schema change. No API change.
- **No "saved templates" feature** — defer to later phase
- **No template editor** — 4 hard-coded templates only
- **CMD interprets** the structured markdown via SYSTEM_PROMPT v2 (Part 1 above) — no further prompt update needed

═══════════════════════════════════════════════════════════
FILES TO CREATE / MODIFY
═══════════════════════════════════════════════════════════

**CREATE:**
- `src/components/templates/TemplateSheet.tsx` — bottom sheet container with picker + form views
- `src/components/templates/templates.config.ts` — template definitions, formatters
- `src/components/templates/template-sheet.css` — bottom sheet styling

**MODIFY:**
- Input area component — add templates trigger button, wire to TemplateSheet open state, accept compose callback that drops markdown into textarea

═══════════════════════════════════════════════════════════
COMPONENT IMPLEMENTATION
═══════════════════════════════════════════════════════════

**`src/components/templates/templates.config.ts`:**

```typescript
export type TemplateType = 'build' | 'hotfix' | 'review' | 'report'

export interface TemplateField {
  name: string
  label: string
  type: 'text' | 'textarea' | 'radio'
  required?: boolean
  options?: string[]
  default?: string
  placeholder?: string
}

export interface TemplateDef {
  type: TemplateType
  label: string
  description: string
  agent: string
  fields: TemplateField[]
  format: (values: Record<string, string>) => string
}

export const TEMPLATES: TemplateDef[] = [
  {
    type: 'build',
    label: 'Build',
    description: 'New feature or code addition',
    agent: 'WARP•FORGE',
    fields: [
      { name: 'feature', label: 'Feature', type: 'textarea', required: true, placeholder: 'What to build' },
      { name: 'branch_hint', label: 'Branch hint', type: 'text', placeholder: 'e.g. dashboard-ui (optional)' },
      { name: 'scope', label: 'Scope', type: 'text', placeholder: 'Files / surfaces (optional)' },
      { name: 'acceptance', label: 'Acceptance', type: 'text', placeholder: 'Success criterion (optional)' },
      { name: 'priority', label: 'Priority', type: 'radio', options: ['low', 'medium', 'high'], default: 'medium' },
    ],
    format: (v) => `[BUILD]
Feature: ${v.feature}
Branch hint: ${v.branch_hint || 'auto'}
Scope: ${v.scope || '—'}
Acceptance: ${v.acceptance || '—'}
Priority: ${v.priority || 'medium'}`,
  },
  {
    type: 'hotfix',
    label: 'Hotfix',
    description: 'Bug fix or regression repair',
    agent: 'WARP•FORGE',
    fields: [
      { name: 'bug', label: 'Bug', type: 'textarea', required: true, placeholder: "What's broken, observable symptom" },
      { name: 'surface', label: 'Surface', type: 'text', placeholder: 'Where it appears (optional)' },
      { name: 'severity', label: 'Severity', type: 'radio', options: ['low', 'medium', 'critical'], default: 'medium' },
    ],
    format: (v) => `[HOTFIX]
Bug: ${v.bug}
Surface: ${v.surface || '—'}
Severity: ${v.severity || 'medium'}`,
  },
  {
    type: 'review',
    label: 'Review',
    description: 'Audit a branch or PR before merge',
    agent: 'WARP•SENTINEL',
    fields: [
      { name: 'target_ref', label: 'Target', type: 'text', required: true, placeholder: 'Branch name or PR URL' },
      { name: 'focus', label: 'Focus', type: 'textarea', placeholder: 'Specific concerns (optional)' },
    ],
    format: (v) => `[REVIEW]
Target: ${v.target_ref}
Focus: ${v.focus || 'general audit'}`,
  },
  {
    type: 'report',
    label: 'Report',
    description: 'Status report or project update',
    agent: 'WARP•ECHO',
    fields: [
      { name: 'report_type', label: 'Type', type: 'radio', options: ['project_state', 'branch_summary', 'custom'], default: 'project_state' },
      { name: 'window', label: 'Window', type: 'text', placeholder: 'Time range (optional)' },
      { name: 'custom_prompt', label: 'Custom prompt', type: 'textarea', placeholder: 'Only if type=custom' },
    ],
    format: (v) => `[REPORT]
Type: ${v.report_type || 'project_state'}
Window: ${v.window || 'since last report'}
Custom: ${v.custom_prompt || '—'}`,
  },
]

export function formatTemplateOutput(type: TemplateType, values: Record<string, string>): string {
  const def = TEMPLATES.find(t => t.type === type)
  if (!def) return ''
  return def.format(values)
}
```

**`src/components/templates/TemplateSheet.tsx`:**

```typescript
'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { TEMPLATES, formatTemplateOutput, TemplateType, TemplateField } from './templates.config'
import './template-sheet.css'

interface TemplateSheetProps {
  open: boolean
  onClose: () => void
  onCompose: (markdown: string) => void
}

export function TemplateSheet({ open, onClose, onCompose }: TemplateSheetProps) {
  const [selectedType, setSelectedType] = useState<TemplateType | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})

  if (!open) return null

  const selectedDef = selectedType ? TEMPLATES.find(t => t.type === selectedType) : null

  const handleSelect = (type: TemplateType) => {
    setSelectedType(type)
    const def = TEMPLATES.find(t => t.type === type)
    const defaults: Record<string, string> = {}
    def?.fields.forEach(f => {
      if (f.default) defaults[f.name] = f.default
    })
    setFormValues(defaults)
  }

  const handleClose = () => {
    setSelectedType(null)
    setFormValues({})
    onClose()
  }

  const handleCompose = () => {
    if (!selectedDef) return
    const required = selectedDef.fields.filter(f => f.required)
    for (const f of required) {
      if (!formValues[f.name]) return  // silently bail; UI should show validation
    }
    const markdown = formatTemplateOutput(selectedType!, formValues)
    onCompose(markdown)
    handleClose()
  }

  const handleBack = () => {
    setSelectedType(null)
    setFormValues({})
  }

  return (
    <>
      <div className="ts-backdrop" onClick={handleClose} />
      <div className="ts-sheet">
        <div className="ts-handle" />
        <div className="ts-header">
          <span className="ts-title">
            {selectedDef ? selectedDef.label : 'Templates'}
          </span>
          <button className="ts-close" onClick={handleClose} aria-label="Close">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="ts-body">
          {!selectedDef && (
            <div className="ts-grid">
              {TEMPLATES.map(t => (
                <button
                  key={t.type}
                  className="ts-card"
                  onClick={() => handleSelect(t.type)}
                >
                  <span className="ts-card-label">{t.label}</span>
                  <span className="ts-card-desc">{t.description}</span>
                  <span className="ts-card-agent">{t.agent}</span>
                </button>
              ))}
            </div>
          )}

          {selectedDef && (
            <div className="ts-form">
              <button className="ts-back" onClick={handleBack}>← Back</button>
              {selectedDef.fields.map(f => (
                <FormField
                  key={f.name}
                  field={f}
                  value={formValues[f.name] ?? ''}
                  onChange={(v) => setFormValues(prev => ({ ...prev, [f.name]: v }))}
                />
              ))}
              <button className="ts-compose" onClick={handleCompose}>
                Compose
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function FormField({ field, value, onChange }: {
  field: TemplateField
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="ts-field">
      <label className="ts-field-label">
        {field.label}
        {field.required && <span className="ts-field-required"> *</span>}
      </label>
      {field.type === 'text' && (
        <input
          type="text"
          className="ts-field-input"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )}
      {field.type === 'textarea' && (
        <textarea
          className="ts-field-textarea"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )}
      {field.type === 'radio' && field.options && (
        <div className="ts-field-radio">
          {field.options.map(opt => (
            <button
              key={opt}
              type="button"
              className={`ts-radio-pill ${value === opt ? 'is-active' : ''}`}
              onClick={() => onChange(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

**`src/components/templates/template-sheet.css`:**

```css
.ts-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 50;
  animation: ts-fade-in 180ms ease;
}

.ts-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: #0e0e0f;
  border-top: 1px solid rgba(255,255,255,0.10);
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  z-index: 51;
  animation: ts-slide-up 220ms cubic-bezier(0.2, 0.9, 0.3, 1);
  font-family: var(--font-sans);
}

@keyframes ts-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes ts-slide-up { from { transform: translateY(100%) } to { transform: translateY(0) } }

.ts-handle {
  width: 40px;
  height: 4px;
  background: rgba(255,255,255,0.18);
  border-radius: 2px;
  margin: 8px auto 0;
}

.ts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
}

.ts-title {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  color: rgba(255,255,255,0.95);
  letter-spacing: 0.02em;
}

.ts-close {
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.55);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
}
.ts-close:hover { color: rgba(255,255,255,1); background: rgba(255,255,255,0.05); }

.ts-body {
  padding: 0 16px 20px;
  overflow-y: auto;
  flex: 1;
}

/* Template picker grid */
.ts-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 8px;
}

.ts-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  text-align: left;
  transition: border-color 120ms ease, background 120ms ease;
}
.ts-card:hover {
  border-color: rgba(255,255,255,0.20);
  background: rgba(255,255,255,0.06);
}

.ts-card-label {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 500;
  color: rgba(255,255,255,0.95);
}
.ts-card-desc {
  font-size: 11px;
  color: rgba(255,255,255,0.55);
  line-height: 1.4;
}
.ts-card-agent {
  font-family: var(--font-mono);
  font-size: 10px;
  color: #3b82f6;
  margin-top: 4px;
  letter-spacing: 0.04em;
}

/* Form view */
.ts-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 8px;
}

.ts-back {
  align-self: flex-start;
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.55);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;
  margin-bottom: 4px;
}
.ts-back:hover { color: rgba(255,255,255,0.9); }

.ts-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ts-field-label {
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(255,255,255,0.55);
}
.ts-field-required { color: #ef4444; }

.ts-field-input,
.ts-field-textarea {
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.03);
  color: rgba(255,255,255,0.95);
  width: 100%;
  outline: none;
  transition: border-color 120ms ease;
}
.ts-field-input:focus,
.ts-field-textarea:focus { border-color: rgba(255,255,255,0.30); }

.ts-field-textarea {
  min-height: 80px;
  max-height: 200px;
  resize: vertical;
  line-height: 1.5;
}

.ts-field-radio {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.ts-radio-pill {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.12);
  background: transparent;
  color: rgba(255,255,255,0.65);
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.ts-radio-pill.is-active {
  border-color: #3b82f6;
  background: rgba(59,130,246,0.12);
  color: #93c5fd;
}

.ts-compose {
  margin-top: 8px;
  height: 44px;
  border-radius: 10px;
  border: none;
  background: rgba(255,255,255,0.95);
  color: #0a0a0a;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
}
.ts-compose:hover { background: #ffffff; transform: translateY(-1px); }
.ts-compose:active { transform: translateY(0); }
```

═══════════════════════════════════════════════════════════
INPUT AREA INTEGRATION
═══════════════════════════════════════════════════════════

In the input area component (the same component edited in Phase 1.5d), add the templates icon button and wire the TemplateSheet:

```tsx
import { useState } from 'react'
import { ArrowUp, LayoutGrid } from 'lucide-react'
import { TemplateSheet } from '@/components/templates/TemplateSheet'
import { MODELS, formatModelSlug } from '@/lib/models'

export function InputArea({ ... }) {
  const [inputValue, setInputValue] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)

  const handleCompose = (markdown: string) => {
    setInputValue(markdown)  // drop into textarea, do NOT auto-send
  }

  return (
    <div className="input-container">
      <textarea
        className="input-textarea"
        value={inputValue}
        onChange={e => setInputValue(e.target.value)}
        placeholder="Send a directive"
      />
      <div className="input-meta">
        <div className="input-meta-left">
          <button
            className="input-templates-btn"
            onClick={() => setSheetOpen(true)}
            aria-label="Templates"
          >
            <LayoutGrid size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="input-meta-right">
          <button className="input-model-chip" disabled>
            WARP🔹CMD · {formatModelSlug(MODELS.cmd)}
          </button>
          <button
            className="input-send"
            disabled={!inputValue.trim()}
            onClick={handleSend}
            aria-label="Send"
          >
            <ArrowUp size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      <TemplateSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCompose={handleCompose}
      />
    </div>
  )
}
```

CSS for templates trigger:
```css
.input-meta-left,
.input-meta-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.input-templates-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.10);
  color: rgba(255,255,255,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;
}
.input-templates-btn:hover {
  border-color: rgba(255,255,255,0.25);
  color: rgba(255,255,255,0.9);
}
```

═══════════════════════════════════════════════════════════
PART 2 VERIFICATION
═══════════════════════════════════════════════════════════

1. Templates icon visible in input area, left of model chip — small bordered square with grid icon
2. Tap icon → bottom sheet slides up showing 4 cards (Build / Hotfix / Review / Report) with description + agent label
3. Tap **Build** → form view with 5 fields appears
4. Required field (`feature`) marked with red asterisk
5. Fill `feature: "Test new feature"`, leave others blank, Priority: medium
6. Tap **Compose** → sheet closes, textarea now contains:
   ```
   [BUILD]
   Feature: Test new feature
   Branch hint: auto
   Scope: —
   Acceptance: —
   Priority: medium
   ```
7. Tap Send → message goes through /api/chat
8. CMD responds with directive block:
   - `TARGET: WARP•FORGE`
   - `TASK:` derived from "Test new feature"
   - `BRANCH: WARP/test-new-feature` (auto-computed since branch_hint was "auto") — must be lowercase, hyphens, no dots, no date suffix
   - `PRIORITY: medium`
   - NO ceremonial preamble (Part 1 enforces this)
9. Repeat for **Hotfix** → expect `[HOTFIX]` markdown, CMD routes to WARP•FORGE
10. Repeat for **Review** → expect `[REVIEW]` markdown, CMD routes to WARP•SENTINEL
11. Repeat for **Report** → expect `[REPORT]` markdown, CMD routes to WARP•ECHO
12. Mobile width 360-412px — sheet fits, form fields don't overflow, radio pills wrap if needed

═══════════════════════════════════════════════════════════
HARD CONSTRAINTS — DO NOT VIOLATE
═══════════════════════════════════════════════════════════

- DO NOT modify SYSTEM_PROMPT beyond Part 1 above
- DO NOT modify DB schema or API routes
- DO NOT add a template editor or saved templates feature
- DO NOT auto-send the composed markdown — drop into textarea, let user review and tap Send
- DO NOT add packages beyond what's already installed (lucide-react and geist are already there)
- DO NOT change existing chat/sidebar/header components beyond the input area integration
- The 4 templates are static — they live in `templates.config.ts` and don't pull from DB
- DO NOT skip mobile testing — sheet must work cleanly at 360-412px width
- DO NOT touch Phase 1.5d changes (header, fonts, send button, text scale) — those are already merged before this bundle starts
