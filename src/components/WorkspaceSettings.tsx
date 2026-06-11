"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PushNotificationToggle from "@/components/PushNotificationToggle";
import { authFetch } from "@/lib/api-fetch";

/**
 * Workspace settings — the operator-facing panel for the three workspace
 * features that drive the chat system prompt:
 *   - Custom instructions (app_settings)
 *   - Memory (manual + auto-captured, with review)
 *   - Skills (installed SKILL.md modules)
 *
 * Reuses the existing `cs-*` modal styling from globals.css.
 */

type Tab = "instructions" | "memory" | "skills" | "admin";

type Provider = "openrouter" | "openai" | "blackbox";

type ProviderKeyPublic = {
  id: string;
  provider: Provider;
  label: string;
  enabled: boolean;
  priority: number;
  last_error: string | null;
  keyPreview: string;
};

type BalanceResult = {
  supported: boolean;
  valid: "valid" | "invalid" | "unknown";
  credits: number | null;
  usage: number | null;
  remaining: number | null;
  currency: string;
  note?: string;
  error?: string;
};

type BalanceState = { loading: boolean; data?: BalanceResult };

type Memory = {
  id: string;
  content: string;
  source: "manual" | "auto";
  status: "active" | "pending" | "archived";
  created_at: string;
};

type Skill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  triggers: string[];
  enabled: boolean;
};

export default function WorkspaceSettings({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("instructions");
  const [isAdmin, setIsAdmin] = useState(false);

  // Resolve the signed-in user's role so the Admin tab only shows for admins.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    authFetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { role?: string } | null) => {
        if (!cancelled) setIsAdmin(d?.role === "admin");
      })
      .catch(() => {
        /* not signed in / no role — hide admin */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="cs-root"
      role="dialog"
      aria-modal="true"
      aria-label="Workspace settings"
    >
      <div className="cs-backdrop" onClick={onClose} />
      <div className="cs-modal">
        <div className="cs-header">
          <div>
            <div className="cs-eyebrow">Workspace</div>
            <div className="cs-title">Settings</div>
          </div>
          <button
            type="button"
            className="cs-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <div className="ws-tabs" role="tablist">
          <TabButton id="instructions" tab={tab} setTab={setTab}>
            Instructions
          </TabButton>
          <TabButton id="memory" tab={tab} setTab={setTab}>
            Memory
          </TabButton>
          <TabButton id="skills" tab={tab} setTab={setTab}>
            Skills
          </TabButton>
          {isAdmin && (
            <TabButton id="admin" tab={tab} setTab={setTab}>
              Admin
            </TabButton>
          )}
        </div>

        {tab === "instructions" && <InstructionsTab />}
        {tab === "memory" && <MemoryTab />}
        {tab === "skills" && <SkillsTab />}
        {tab === "admin" && isAdmin && <AdminTab />}

        <PushNotificationToggle />
      </div>
    </div>
  );
}

function TabButton({
  id,
  tab,
  setTab,
  children,
}: {
  id: Tab;
  tab: Tab;
  setTab: (t: Tab) => void;
  children: React.ReactNode;
}) {
  const active = tab === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className="cs-action"
      style={{
        flex: "1 0 auto",
        whiteSpace: "nowrap",
        opacity: active ? 1 : 0.6,
        borderColor: active ? "var(--accent, #6ea8fe)" : undefined,
      }}
      onClick={() => setTab(id)}
    >
      {children}
    </button>
  );
}

// ─────────────────────────── Instructions ───────────────────────────

function InstructionsTab() {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { customInstructions?: string }) => {
        if (!cancelled) setValue(d.customInstructions ?? "");
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customInstructions: value }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setFlash("Saved. Applies to your next message.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <p className="ws-help">
        Always-on guidance for the assistant — tone, stack preferences, how you
        like answers. Injected into every chat.
      </p>
      <textarea
        className="ws-textarea"
        rows={8}
        value={value}
        disabled={loading}
        placeholder="e.g. I work in TypeScript + Next.js. Prefer concise answers with runnable code. Reply in Bahasa Indonesia."
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="cs-actions">
        <button
          type="button"
          className="cs-action"
          onClick={save}
          disabled={saving || loading}
        >
          {saving ? "Saving…" : "SAVE"}
        </button>
      </div>
      {flash && <div className="cs-flash">{flash}</div>}
      {error && <div className="cs-error">{error}</div>}
    </div>
  );
}

// ───────────────────────────── Memory ─────────────────────────────

function MemoryTab() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [newContent, setNewContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memory", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { memories: Memory[] };
      setMemories(d.memories ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const content = newContent.trim();
    if (!content) return;
    setBusy(true);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewContent("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "add failed");
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
  };
  const remove = async (id: string) => {
    await fetch(`/api/memory/${id}`, { method: "DELETE" });
    await load();
  };

  const pending = memories.filter((m) => m.status === "pending");
  const active = memories.filter((m) => m.status === "active");

  return (
    <div>
      <p className="ws-help">
        Durable facts the assistant remembers across sessions. Add your own, or
        review what it picked up automatically.
      </p>

      <div className="ws-add-row">
        <input
          className="ws-input"
          value={newContent}
          placeholder="Add a memory…"
          onChange={(e) => setNewContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
        />
        <button
          type="button"
          className="cs-action"
          onClick={add}
          disabled={busy || !newContent.trim()}
        >
          ADD
        </button>
      </div>

      {pending.length > 0 && (
        <>
          <div className="cs-section-title">
            Pending review ({pending.length})
          </div>
          <ul className="ws-list">
            {pending.map((m) => (
              <li key={m.id} className="ws-item">
                <span className="ws-item-text">{m.content}</span>
                <span className="ws-item-actions">
                  <button
                    type="button"
                    className="ws-mini"
                    title="Approve"
                    onClick={() => patch(m.id, { status: "active" })}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="ws-mini"
                    title="Dismiss"
                    onClick={() => remove(m.id)}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="cs-section-title">Active ({active.length})</div>
      <ul className="ws-list">
        {active.length === 0 && <li className="ws-empty">No memories yet.</li>}
        {active.map((m) => (
          <li key={m.id} className="ws-item">
            <span className="ws-item-text">
              {m.content}
              {m.source === "auto" && <span className="ws-badge">auto</span>}
            </span>
            <span className="ws-item-actions">
              <button
                type="button"
                className="ws-mini"
                title="Delete"
                onClick={() => remove(m.id)}
              >
                🗑
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && <div className="cs-error">{error}</div>}
    </div>
  );
}

// ───────────────────────────── Skills ─────────────────────────────

function SkillsTab() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/skills", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { skills: Skill[] };
      setSkills(d.skills ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const installMarkdown = useCallback(
    async (md: string) => {
      const body = md.trim();
      if (!body) return;
      setBusy(true);
      setError(null);
      setFlash(null);
      try {
        const res = await fetch("/api/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markdown: body }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          skill?: Skill;
          error?: string;
        };
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        setMarkdown("");
        setFlash(`Installed "${j.skill?.name ?? "skill"}".`);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "install failed");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const install = () => installMarkdown(markdown);

  // Install from a public GitHub link to a SKILL.md / *.md file.
  const installFromUrl = useCallback(async () => {
    const link = url.trim();
    if (!link) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        skill?: Skill;
        error?: string;
      };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setUrl("");
      setFlash(`Installed "${j.skill?.name ?? "skill"}" from GitHub.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "import failed");
    } finally {
      setBusy(false);
    }
  }, [url, load]);

  // One-tap install from a SKILL.md file — read it client-side and install.
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ""; // allow re-picking same file
    if (!file) return;
    if (file.size > 256 * 1024) {
      setError("File too large — SKILL.md must be under 256 KB.");
      return;
    }
    try {
      const text = await file.text();
      await installMarkdown(text);
    } catch {
      setError("Could not read the file.");
    }
  };

  const toggle = async (s: Skill) => {
    await fetch(`/api/skills/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    await load();
  };
  const remove = async (id: string) => {
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div>
      <p className="ws-help">
        Install SKILL.md modules to extend the assistant. Upload a{" "}
        <code>.md</code> file, paste a GitHub link, or paste a skill with
        optional <code>---</code> frontmatter (<code>name</code>,{" "}
        <code>description</code>, <code>triggers</code>).
      </p>

      <div className="cs-actions" style={{ marginBottom: 10 }}>
        <input
          ref={fileRef}
          type="file"
          accept=".md,text/markdown,text/plain"
          className="hidden"
          onChange={onPickFile}
        />
        <button
          type="button"
          className="cs-action"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Installing…" : "⬆ UPLOAD .md"}
        </button>
      </div>

      <div className="ws-add-row">
        <input
          className="ws-input"
          value={url}
          placeholder="GitHub link to SKILL.md"
          inputMode="url"
          autoComplete="off"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void installFromUrl();
          }}
          style={{ flex: "1 1 auto" }}
        />
        <button
          type="button"
          className="cs-action"
          onClick={() => void installFromUrl()}
          disabled={busy || !url.trim()}
        >
          {busy ? "Installing…" : "INSTALL FROM URL"}
        </button>
      </div>

      <ul className="ws-list">
        {skills.length === 0 && (
          <li className="ws-empty">No skills installed.</li>
        )}
        {skills.map((s) => (
          <li key={s.id} className="ws-item">
            <span className="ws-item-text">
              <strong>{s.name}</strong>
              <span className="ws-item-desc">{s.description}</span>
            </span>
            <span className="ws-item-actions">
              <button
                type="button"
                role="switch"
                aria-checked={s.enabled}
                className={`ws-switch${s.enabled ? " is-on" : ""}`}
                title={s.enabled ? "Active — tap to remove" : "Tap to add skill"}
                onClick={() => toggle(s)}
              >
                <span className="ws-switch-knob" />
              </button>
              <button
                type="button"
                className="ws-mini"
                title="Delete"
                onClick={() => remove(s.id)}
              >
                🗑
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="cs-section-title">Install a skill</div>
      <textarea
        className="ws-textarea"
        rows={7}
        value={markdown}
        placeholder={"---\nname: Python Expert\ndescription: Idiomatic, well-tested Python\ntriggers: python, pytest, django\n---\n\nWhen writing Python, prefer type hints and..."}
        onChange={(e) => setMarkdown(e.target.value)}
      />
      <div className="cs-actions">
        <button
          type="button"
          className="cs-action"
          onClick={install}
          disabled={busy || !markdown.trim()}
        >
          {busy ? "Installing…" : "INSTALL SKILL"}
        </button>
      </div>
      {flash && <div className="cs-flash">{flash}</div>}
      {error && <div className="cs-error">{error}</div>}
    </div>
  );
}

// ───────────────────────────── Admin ─────────────────────────────

const PROVIDERS: Provider[] = ["openrouter", "openai", "blackbox"];

function formatCredits(n: number, currency: string): string {
  const sym = currency === "USD" ? "$" : "";
  const suffix = currency && currency !== "USD" ? ` ${currency}` : "";
  return `${sym}${n.toFixed(2)}${suffix}`;
}

/** Coloured dot showing whether the key authenticates: valid / invalid / unknown. */
function KeyStatusDot({ bal }: { bal?: BalanceState }) {
  const v = bal?.loading ? "checking" : (bal?.data?.valid ?? "unknown");
  const title =
    v === "valid"
      ? "API key valid"
      : v === "invalid"
        ? "API key invalid or rejected"
        : v === "checking"
          ? "Checking key…"
          : "Validity unknown";
  return <span className={`ws-key-dot is-${v}`} title={title} aria-label={title} />;
}

/** Render a key's balance: remaining (with used/total tooltip) or a graceful n/a. */
function CreditValue({ bal }: { bal?: BalanceState }) {
  if (!bal || bal.loading) {
    return <span className="ws-credit-value is-muted">…</span>;
  }
  const d = bal.data;
  if (!d || !d.supported) {
    return (
      <span className="ws-credit-value is-muted" title={d?.note ?? d?.error ?? "Not available"}>
        n/a
      </span>
    );
  }
  const main =
    d.remaining !== null
      ? formatCredits(d.remaining, d.currency)
      : d.credits !== null
        ? formatCredits(d.credits, d.currency)
        : "—";
  const detail =
    d.credits !== null && d.usage !== null
      ? `${formatCredits(d.usage, d.currency)} used of ${formatCredits(d.credits, d.currency)}`
      : undefined;
  return (
    <span className="ws-credit-value" title={detail}>
      {main} left
    </span>
  );
}

function AdminTab() {
  const [keys, setKeys] = useState<ProviderKeyPublic[]>([]);
  const [balances, setBalances] = useState<Record<string, BalanceState>>({});
  const [provider, setProvider] = useState<Provider>("blackbox");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [priority, setPriority] = useState("100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/admin/provider-keys");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { keys: ProviderKeyPublic[] };
      setKeys(d.keys ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  const loadBalance = useCallback(async (id: string) => {
    setBalances((b) => ({ ...b, [id]: { loading: true, data: b[id]?.data } }));
    try {
      const res = await authFetch(`/api/admin/provider-keys/${id}/balance`);
      const d = (await res.json().catch(() => ({}))) as { balance?: BalanceResult };
      setBalances((b) => ({ ...b, [id]: { loading: false, data: d.balance } }));
    } catch {
      setBalances((b) => ({ ...b, [id]: { loading: false, data: b[id]?.data } }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Lazily fetch each key's balance once it appears in the list.
  useEffect(() => {
    for (const k of keys) {
      if (!(k.id in balances)) void loadBalance(k.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  const add = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await authFetch("/api/admin/provider-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey: key,
          label: label.trim(),
          priority: Number.isFinite(Number(priority))
            ? Math.trunc(Number(priority))
            : undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setApiKey("");
      setLabel("");
      setPriority("100");
      setFlash(`Saved ${provider} key.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (k: ProviderKeyPublic) => {
    await authFetch(`/api/admin/provider-keys/${k.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !k.enabled }),
    });
    await load();
  };
  // Commit an inline priority edit. No-op when unchanged or non-numeric so a
  // plain focus/blur doesn't fire a needless PATCH.
  const savePriority = async (k: ProviderKeyPublic, value: string) => {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n) || n === k.priority) return;
    await authFetch(`/api/admin/provider-keys/${k.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: n }),
    });
    await load();
  };
  const remove = async (id: string) => {
    await authFetch(`/api/admin/provider-keys/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div>
      <p className="ws-help">
        Provider API keys (admin only). Chat auto-switches across enabled keys —
        if one runs out of credit or is rate-limited, the next one is used.
        Lower priority is tried first. Keys are stored server-side and shown
        masked.
      </p>

      <ul className="ws-list">
        {keys.length === 0 && (
          <li className="ws-empty">
            No provider keys yet — env keys (if any) are used as a fallback.
          </li>
        )}
        {keys.map((k) => {
          const bal = balances[k.id];
          return (
            <li key={k.id} className="ws-item">
              <span className="ws-item-text">
                <strong>
                  <KeyStatusDot bal={bal} />
                  {k.provider}
                </strong>
                <span className="ws-item-desc">
                  {k.keyPreview}
                  {k.label ? ` · ${k.label}` : ""}
                  {" · p"}
                  <input
                    // Re-key on priority so the uncommitted defaultValue resets
                    // to the server value after each load().
                    key={`prio-${k.id}-${k.priority}`}
                    type="number"
                    min={1}
                    max={999}
                    defaultValue={k.priority}
                    className="ws-input ws-prio-input"
                    title="Priority — lower is tried first"
                    aria-label={`Priority for ${k.provider} key`}
                    onBlur={(e) => void savePriority(k, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                  {k.last_error ? ` · ⚠ ${k.last_error}` : ""}
                </span>
                <span className="ws-credit">
                  <span className="ws-credit-label">credit</span>
                  <CreditValue bal={bal} />
                  <button
                    type="button"
                    className="ws-credit-refresh"
                    title="Refresh balance"
                    aria-label="Refresh balance"
                    onClick={() => loadBalance(k.id)}
                    disabled={bal?.loading}
                  >
                    ↻
                  </button>
                </span>
              </span>
              <span className="ws-item-actions">
                <button
                  type="button"
                  role="switch"
                  aria-checked={k.enabled}
                  className={`ws-switch${k.enabled ? " is-on" : ""}`}
                  title={k.enabled ? "Enabled — tap to disable" : "Disabled — tap to enable"}
                  onClick={() => toggle(k)}
                >
                  <span className="ws-switch-knob" />
                </button>
                <button
                  type="button"
                  className="ws-mini"
                  title="Delete"
                  onClick={() => remove(k.id)}
                >
                  🗑
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="cs-section-title">Add a key</div>
      <div className="ws-add-row">
        <select
          className="ws-input"
          value={provider}
          onChange={(e) => setProvider(e.target.value as Provider)}
          style={{ flex: "1 1 130px" }}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          className="ws-input"
          value={label}
          placeholder="label (optional)"
          onChange={(e) => setLabel(e.target.value)}
          style={{ flex: "1 1 120px" }}
        />
        <input
          className="ws-input"
          value={priority}
          type="number"
          min={1}
          max={999}
          placeholder="priority"
          title="Priority — lower is tried first"
          aria-label="Priority for new key"
          onChange={(e) => setPriority(e.target.value)}
          style={{ flex: "0 0 84px" }}
        />
      </div>
      <div className="ws-add-row">
        <input
          className="ws-input"
          value={apiKey}
          placeholder={`${provider} API key`}
          type="password"
          autoComplete="off"
          onChange={(e) => setApiKey(e.target.value)}
        />
        <button
          type="button"
          className="cs-action"
          onClick={add}
          disabled={busy || !apiKey.trim()}
        >
          {busy ? "Saving…" : "SAVE KEY"}
        </button>
      </div>
      {flash && <div className="cs-flash">{flash}</div>}
      {error && <div className="cs-error">{error}</div>}
    </div>
  );
}
