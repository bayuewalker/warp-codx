**Phase 2 Rollback + Phase 2.5 Visual Refinement** — combined dispatch.

Four parts in one pass:
- **PART A:** Delete the template forms feature shipped in Phase 2 (anti-pattern — CMD interprets prose, no forms needed).
- **PART B:** Refactor input toolbar to mockup v2 visual pattern (paperclip + grid placeholders + spacer + send button — NO model selector inside the composer).
- **PART C:** Add `<SessionBar />` component shell mounted hidden — Phase 3 will wire visible task data.
- **PART D:** Composer simplification: footer collapses to LED + model name only (no IDLE text, no separate STOP). Send button morphs into stop button while streaming.

⚠️ **PREREQUISITE:** Phase 1.5d (design migration) is verified merged. Phase 2 (templates) was shipped — this rollback removes it cleanly.

⚠️ **HEADER UNCHANGED:** Phase 1.5d header (status strip with NET/RT/RUN/AGT LEDs + nav strip with hamburger + WARP CodX wordmark + plus) stays exactly as-is. Do not touch it.

═══════════════════════════════════════════════════════════
PART A — Delete template forms feature
═══════════════════════════════════════════════════════════

**Files to DELETE:**
- `src/components/templates/TemplateSheet.tsx`
- `src/components/templates/templates.config.ts`
- `src/components/templates/template-sheet.css`
- The entire `src/components/templates/` folder if empty after deletion

**In input area component, REMOVE:**
- `import { TemplateSheet } from '@/components/templates/TemplateSheet'`
- `import { LayoutGrid } from 'lucide-react'` (if only used for templates trigger)
- `useState` hook for `sheetOpen` / `setSheetOpen`
- `handleCompose` callback function
- `<TemplateSheet />` JSX render
- The templates trigger button (`<button className="input-templates-btn">`)
- The `.input-meta-left` wrapper div if it only contained the templates button

**Verify after deletion:**
- `npm run build` succeeds — no broken imports
- No TypeScript errors
- App loads without runtime error
- Input area renders without templates icon

═══════════════════════════════════════════════════════════
PART B — Refactor input toolbar to mockup v2 pattern
═══════════════════════════════════════════════════════════

After Part A removes the old templates button, restructure the input toolbar to match mockup v2 visual pattern (paperclip + grid + CMD chip + send), with all sizes minimized per spec below.

**New input area JSX structure:**

```tsx
import { useState } from 'react'
import { Paperclip, LayoutGrid, ArrowUp } from 'lucide-react'
import { MODELS, formatModelSlug } from '@/lib/models'

export function InputArea({ onSend, ... }) {
  const [inputValue, setInputValue] = useState('')

  return (
    <div className="input-zone-wrap">
      <div className="input-zone">
        <textarea
          className="input-field"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          placeholder="Describe your task or type / for commands"
          rows={1}
        />

        <div className="input-toolbar">
          {/* Paperclip — disabled placeholder for future file attach */}
          <button
            className="input-tool-btn"
            title="Attach (coming soon)"
            disabled
            aria-label="Attach file"
          >
            <Paperclip size={14} strokeWidth={2} />
          </button>

          {/* Grid — disabled placeholder for future quick-actions */}
          <button
            className="input-tool-btn"
            title="Quick actions (coming soon)"
            disabled
            aria-label="Quick actions"
          >
            <LayoutGrid size={14} strokeWidth={2} />
          </button>

          {/* Spacer pushes send button to the right */}
          <span className="input-toolbar-spacer" aria-hidden="true" />

          {/* Send button — Part D will wire send/stop morph based on isStreaming */}
          <button
            className="input-send-btn"
            onClick={() => onSend(inputValue)}
            disabled={!inputValue.trim()}
            title="Send"
            aria-label="Send"
          >
            <ArrowUp size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  )
}
```

**CSS — minimized sizes (apply to existing input area stylesheet):**

```css
/* Input toolbar — minimized per mockup v2 spec */
.input-toolbar {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
}

/* Paperclip + grid placeholder buttons */
.input-tool-btn {
  width: 26px;
  height: 26px;
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.40);
  cursor: not-allowed;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0.6;
  transition: opacity 120ms ease, color 120ms ease;
}
.input-tool-btn:not(:disabled):hover {
  opacity: 1;
  color: rgba(255,255,255,0.95);
  background: rgba(255,255,255,0.05);
  cursor: pointer;
}

/* Spacer pushes send button to far right of toolbar */
.input-toolbar-spacer {
  flex: 1;
}

/* Send button — minimized 28x28. Part D adds streaming morph variants. */
.input-send-btn {
  width: 28px;
  height: 28px;
  background: rgba(255,255,255,0.95);
  color: #0a0a0a;
  border: none;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 180ms ease, color 180ms ease, transform 120ms ease;
}
.input-send-btn:hover {
  background: #ffffff;
  transform: translateY(-1px);
}
.input-send-btn:disabled {
  background: rgba(255,255,255,0.10);
  color: rgba(255,255,255,0.35);
  cursor: not-allowed;
  transform: none;
}
```

═══════════════════════════════════════════════════════════
PART C — Session bar component (prep for Phase 3)
═══════════════════════════════════════════════════════════

Create the component now (renders empty until Phase 3 provides task data). Minimized per spec.

**CREATE:** `src/components/SessionBar.tsx`

```tsx
'use client'

import { Hexagon, ChevronDown } from 'lucide-react'

export interface SessionBarProps {
  taskTitle?: string
  progressPercent?: number  // 0-100
  visible?: boolean
}

export function SessionBar({ taskTitle, progressPercent, visible = false }: SessionBarProps) {
  // Phase 2.5: render only when visible AND has task data
  // Phase 3 will pass real data from active issue/PR state
  if (!visible || !taskTitle) return null

  const pct = Math.max(0, Math.min(100, progressPercent ?? 0))

  return (
    <div className="session-bar">
      <div className="session-icon" aria-hidden="true">
        <Hexagon size={9} strokeWidth={2} />
      </div>
      <div className="session-title-block">
        <div className="session-title">
          <span>{taskTitle}</span>
          <ChevronDown size={9} className="session-chev" />
        </div>
        <div className="session-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="session-progress-bar" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}
```

**CSS — append to globals.css or create `src/components/session-bar.css`:**

```css
.session-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px 7px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.session-icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(59,130,246,0.10);
  border: 1px solid rgba(59,130,246,0.30);
  color: #3b82f6;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.session-icon svg {
  width: 9px;
  height: 9px;
}

.session-title-block {
  flex: 1;
  overflow: hidden;
}

.session-title {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: rgba(255,255,255,0.95);
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.session-chev {
  color: rgba(255,255,255,0.40);
  font-size: 9px;
  flex-shrink: 0;
}

.session-progress {
  height: 1px;
  background: rgba(255,255,255,0.08);
  margin-top: 5px;
  border-radius: 1px;
  overflow: hidden;
  position: relative;
}

.session-progress-bar {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: linear-gradient(90deg, rgba(59,130,246,0.5), #3b82f6);
  border-radius: 1px;
  transition: width 240ms ease;
}
```

**Mount SessionBar in the main page layout:**

In the page that renders the chat view (likely `src/app/page.tsx` or wherever the header + chat live), add `<SessionBar />` between the header and chat area:

```tsx
<Header />
<SessionBar visible={false} />  {/* Phase 2.5: always hidden. Phase 3 will wire visible + props from active task state */}
<ChatArea />
<InputArea />
```

The component will render nothing now (visible=false). Phase 3 will pass real task data.

═══════════════════════════════════════════════════════════
PART D — Composer simplification (LED + model footer, send/stop morph)
═══════════════════════════════════════════════════════════

Two simplifications to the composer that supersede earlier scaffolding:

1. **No CMD model selector inside the composer toolbar.** The toolbar contains only: paperclip, grid, spacer, send button. The model name is shown only in the footer below.
2. **No separate STOP text/button.** The send button itself morphs into a stop button while AI is working — same DOM node, same position, icon swap.
3. **Footer collapses to just `● sonnet-4.6`.** No "IDLE" text, no state label, no STOP button. The dot is a health LED tied to model/provider connectivity.

**Updated input area** (this is the FINAL shape — it supersedes Part B's JSX. The Part B/C work still applies for everything else; Part D just defines the composer's final structure):

```tsx
import { useState } from 'react'
import { Paperclip, LayoutGrid, ArrowUp, Square } from 'lucide-react'
import { MODELS, formatModelSlug } from '@/lib/models'

type LedHealth = 'online' | 'checking' | 'error' | 'unknown'

interface InputAreaProps {
  onSend: (content: string) => void
  isStreaming?: boolean
  onStopStream?: () => void
  ledHealth?: LedHealth   // optional — defaults to 'online'. Phase 3 wires real provider check.
}

export function InputArea({
  onSend,
  isStreaming = false,
  onStopStream,
  ledHealth = 'online',
}: InputAreaProps) {
  const [inputValue, setInputValue] = useState('')

  const handleSend = () => {
    if (!inputValue.trim() || isStreaming) return
    onSend(inputValue)
    setInputValue('')
  }

  const handleSendOrStop = () => {
    if (isStreaming) {
      onStopStream?.()
    } else {
      handleSend()
    }
  }

  // Send button is enabled when:
  //  - streaming (so user can stop), OR
  //  - input has content (so user can send)
  const sendBtnDisabled = isStreaming ? !onStopStream : !inputValue.trim()

  return (
    <div className="input-zone-wrap">
      {/* Bordered input zone — textarea + toolbar */}
      <div className="input-zone">
        <textarea
          className="input-field"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          placeholder="Describe your task or type / for commands"
          rows={1}
          disabled={isStreaming}
        />

        <div className="input-toolbar">
          <button className="input-tool-btn" title="Attach (coming soon)" disabled aria-label="Attach file">
            <Paperclip size={14} strokeWidth={2} />
          </button>

          <button className="input-tool-btn" title="Quick actions (coming soon)" disabled aria-label="Quick actions">
            <LayoutGrid size={14} strokeWidth={2} />
          </button>

          <span className="input-toolbar-spacer" aria-hidden="true" />

          {/* Send/stop morph — same button, icon swaps based on isStreaming */}
          <button
            className="input-send-btn"
            data-state={isStreaming ? 'streaming' : 'idle'}
            onClick={handleSendOrStop}
            disabled={sendBtnDisabled}
            title={isStreaming ? 'Stop' : 'Send'}
            aria-label={isStreaming ? 'Stop generation' : 'Send'}
          >
            {isStreaming
              ? <Square size={12} strokeWidth={0} fill="currentColor" />
              : <ArrowUp size={14} strokeWidth={2.5} />
            }
          </button>
        </div>
      </div>

      {/* Footer — LED + model only. No state text, no stop button. */}
      <div className="input-footer">
        <span
          className="footer-led"
          data-health={ledHealth}
          title={`${MODELS.cmd} — ${ledHealth}`}
          aria-label={`Model status: ${ledHealth}`}
        />
        <span className="footer-model">{formatModelSlug(MODELS.cmd)}</span>
      </div>
    </div>
  )
}
```

**CSS — replaces Part B's send button block + adds footer LED. Append/replace as indicated:**

```css
/* Send button — morph variant. REPLACES the simpler version from Part B. */
.input-send-btn {
  width: 28px;
  height: 28px;
  background: rgba(255,255,255,0.95);
  color: #0a0a0a;
  border: none;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 180ms ease, color 180ms ease, transform 120ms ease;
}
.input-send-btn:hover {
  background: #ffffff;
  transform: translateY(-1px);
}

/* Streaming state: red square stop icon */
.input-send-btn[data-state="streaming"] {
  background: #ef4444;
  color: #ffffff;
}
.input-send-btn[data-state="streaming"]:hover {
  background: #dc2626;
}

.input-send-btn:disabled {
  background: rgba(255,255,255,0.10);
  color: rgba(255,255,255,0.35);
  cursor: not-allowed;
  transform: none;
}
/* Streaming + disabled (no abort handler available): keep red but dimmed */
.input-send-btn[data-state="streaming"]:disabled {
  background: rgba(239,68,68,0.30);
  color: rgba(255,255,255,0.50);
}

/* Footer — minimal: LED + model only */
.input-footer {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 4px 0;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
}

.footer-led {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: rgba(255,255,255,0.30);
  transition: background 220ms ease, box-shadow 220ms ease;
}

/* LED health states */
.footer-led[data-health="online"] {
  background: #10b981;
  box-shadow: 0 0 4px rgba(16,185,129,0.55);
}
.footer-led[data-health="checking"] {
  background: #fbbf24;
  box-shadow: 0 0 4px rgba(251,191,36,0.55);
  animation: footer-led-pulse 1.4s ease-in-out infinite;
}
.footer-led[data-health="error"] {
  background: #ef4444;
  box-shadow: 0 0 4px rgba(239,68,68,0.55);
}
.footer-led[data-health="unknown"] {
  background: rgba(255,255,255,0.30);
}

@keyframes footer-led-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}

.footer-model {
  color: rgba(255,255,255,0.65);
  font-weight: 500;
}
```

**Wiring `isStreaming` and `onStopStream`:**

Phase 1 already streams tokens. Locate the stream lifecycle in the chat hook and expose:
- `isStreaming: boolean` — true while stream is open
- `stopStream?: () => void` — calls `controller.abort()` on the active fetch (only if you can wire this safely without refactoring Phase 1)

Pass both into `<InputArea isStreaming={...} onStopStream={...} />`.

If the Phase 1 chat hook does NOT currently expose an abort handler:
- Pass `isStreaming` only, omit `onStopStream`.
- The button still morphs to the red stop icon during streaming, but is disabled (dimmed red) until abort is wired.
- **Do not refactor Phase 1's stream logic in this dispatch** — Phase 4 will add proper abort handling.

**Wiring `ledHealth`:**

For this dispatch, hardcode `ledHealth="online"` (default). Phase 3 will wire a real provider health check (ping OpenRouter `/api/v1/models` on mount + every 60s, set state based on response).

═══════════════════════════════════════════════════════════
VERIFICATION — confirm ALL before saying done
═══════════════════════════════════════════════════════════

Take screenshots:

1. **Input toolbar (idle):** Paperclip + grid icons visible on left (disabled, muted). Spacer pushes the send button to the far right. NO CMD chip / model selector anywhere inside the composer. Send button is a 28×28 white square with a dark up-arrow icon.

2. **Templates gone:** No templates icon, no bottom sheet on tap of any button. Paperclip and grid are disabled and do nothing.

3. **No regressions:** Header (status strip + nav strip + WARP CodX wordmark) UNCHANGED — do not touch the header at all. Chat bubbles unchanged. Sidebar drawer unchanged. Markdown rendering unchanged.

4. **Build clean:** `npm run build` passes, no TypeScript errors, no broken imports from deleted templates folder.

5. **Session bar mounted but hidden:** `<SessionBar visible={false} />` compiles and is mounted in layout, renders null. No visible regression.

6. **Footer minimal:** Below the bordered input zone, a single thin row shows ONLY a small LED dot followed by `sonnet-4.6` in 10px mono. NO "IDLE" word. NO "STOP" text or button. NO state label. NO duplicate model display.

7. **LED color (idle, default):** Green LED with subtle glow when `ledHealth="online"` (the default). Verify the dot is roughly 6×6px and clearly green, not gray.

8. **Send/stop morph (streaming):** When a message is sent and the stream begins:
   - The send button (white bg, up-arrow) transforms to a red bg with a white square stop icon — same DOM node, same position, same size.
   - The textarea becomes disabled.
   - Tapping the morphed button calls `onStopStream` (if wired) and aborts the stream.
   - When the stream completes/errors, the button returns to the white send arrow.

9. **Stop button absent if abort not wired:** If the Phase 1 chat hook does not expose `onStopStream`, the button still morphs visually to red+square during streaming but stays disabled (dimmed). No new abort logic invented.

10. **Diamond emoji NOT in composer anywhere:** Since the CMD chip is gone, there should be NO `🔹` rendered inside the input area at all. (The diamond unicode escape from the previous prep can be removed — search for any `'\u{1F539}'` references in the composer code and delete.)

═══════════════════════════════════════════════════════════
HARD CONSTRAINTS — DO NOT VIOLATE
═══════════════════════════════════════════════════════════

- DO NOT keep any reference to `TemplateSheet`, `templates.config`, or template-related state after Part A
- DO NOT make paperclip or grid functional in this dispatch — they are disabled placeholders
- DO NOT add a CMD/model selector chip inside the composer toolbar. Model name lives in the footer only.
- DO NOT add a separate STOP text or button below the composer. The send button itself morphs into stop.
- DO NOT add an "IDLE" or "STREAMING" text label in the footer. Footer = LED + model name only.
- DO NOT change header structure (status strip + nav strip from Phase 1.5d). Header stays exactly as-is.
- DO NOT change chat bubble layout, MessageContent component, or directive block rendering
- DO NOT change sidebar drawer
- DO NOT add SessionBar functionality beyond the component shell — Phase 3 wires data
- DO NOT add new packages (Paperclip, LayoutGrid, ArrowUp, Square, Hexagon, ChevronDown all already in lucide-react)
- DO NOT modify SYSTEM_PROMPT or `/api/chat` route
- DO NOT modify Supabase schema or message rendering logic
- DO NOT add real provider health-check logic in this dispatch — `ledHealth` defaults to `"online"`. Phase 3 wires the real check.
- DO NOT refactor Phase 1's stream lifecycle. If `onStopStream` is not trivially available, omit it — the button morphs visually but stays disabled.

This dispatch is purely UI cleanup + visual refinement + future-prep component scaffold. No new features.
