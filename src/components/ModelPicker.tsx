"use client";

/**
 * Composer model picker — vendor→model tree.
 *
 * Opens a searchable tree grouped by vendor (Claude, GPT) with "Auto" pinned on
 * top. It only ever offers models a *currently-active* provider can serve:
 * `/api/provider/available` reports which providers are configured + reachable,
 * and `availableSelectableModels` filters the registry to match — so a model
 * whose only providers are down/unconfigured simply doesn't appear.
 *
 * Selection stays provider-agnostic (model id only) so the chat failover chain
 * still picks the live provider per request; this control never pins a provider.
 * The choice is shared app-wide via `useSelectedModel`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MODEL_VENDORS,
  SELECTABLE_MODELS,
  availableSelectableModels,
  type ModelVendor,
  type SelectableModel,
} from "@/lib/models";
import type { Provider } from "@/lib/provider";
import { useSelectedModel } from "@/lib/selected-model";
import { authFetch } from "@/lib/api-fetch";

type Health = "online" | "degraded" | "offline";
type ProviderAvail = { provider: Provider; status: Health };

const PROVIDER_LABEL: Record<Provider, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  blackbox: "Blackbox",
};
const HEALTH_COLOR: Record<Health, string> = {
  online: "#4ade80",
  degraded: "#fbbf24",
  offline: "#f87171",
};

export default function ModelPicker({ disabled = false }: { disabled?: boolean }) {
  const [selected, setSelected] = useSelectedModel();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [avail, setAvail] = useState<ProviderAvail[] | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const current =
    SELECTABLE_MODELS.find((m) => m.id === selected) ?? SELECTABLE_MODELS[0];

  // Active = configured + reachable (anything not hard-offline).
  const activeProviders = useMemo<Provider[]>(
    () => (avail ?? []).filter((p) => p.status !== "offline").map((p) => p.provider),
    [avail],
  );

  // Models a live provider can serve, filtered by the search query.
  const models = useMemo(() => {
    const list = availableSelectableModels(activeProviders);
    const q = query.trim().toLowerCase();
    return q ? list.filter((m) => m.label.toLowerCase().includes(q)) : list;
  }, [activeProviders, query]);

  const auto = models.find((m) => m.id === "auto");
  const byVendor = (v: ModelVendor) => models.filter((m) => m.vendor === v);

  // Fetch availability when the menu opens (cached server-side for 20s).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    authFetch("/api/provider/available", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((d: { providers?: ProviderAvail[] }) => {
        if (!cancelled) setAvail(d.providers ?? []);
      })
      .catch(() => !cancelled && setAvail([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (id: SelectableModel["id"]) => {
    setSelected(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        type="button"
        className="model-picker-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Model: ${current.label} — ${current.hint}`}
      >
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
        </svg>
        <span className="model-picker-label">{current.short}</span>
        <svg viewBox="0 0 24 24" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="model-picker-menu" role="listbox">
          <input
            type="text"
            className="model-picker-search"
            placeholder="Search models…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />

          {avail === null ? (
            <div className="model-picker-empty">Checking providers…</div>
          ) : activeProviders.length === 0 ? (
            <div className="model-picker-empty">
              No active provider. Add an API key in Settings → Admin.
            </div>
          ) : models.length === 0 ? (
            <div className="model-picker-empty">No models match “{query}”.</div>
          ) : (
            <>
              {auto && <ModelItem model={auto} active={auto.id === selected} onPick={pick} />}
              {MODEL_VENDORS.map((vendor) => {
                const items = byVendor(vendor);
                if (items.length === 0) return null;
                return (
                  <div key={vendor} className="model-picker-group">
                    <div className="model-picker-group-label">{vendor}</div>
                    {items.map((m) => (
                      <ModelItem key={m.id} model={m} active={m.id === selected} onPick={pick} />
                    ))}
                  </div>
                );
              })}
            </>
          )}

          {avail && avail.length > 0 && (
            <div className="model-picker-providers">
              {avail.map((p) => (
                <span
                  key={p.provider}
                  className="model-picker-provider"
                  title={`${PROVIDER_LABEL[p.provider]}: ${p.status}`}
                >
                  <span
                    className="model-picker-dot"
                    style={{ background: HEALTH_COLOR[p.status] }}
                    aria-hidden
                  />
                  {PROVIDER_LABEL[p.provider]}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModelItem({
  model,
  active,
  onPick,
}: {
  model: SelectableModel;
  active: boolean;
  onPick: (id: SelectableModel["id"]) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`model-picker-item${active ? " is-active" : ""}`}
      onClick={() => onPick(model.id)}
    >
      <span className="model-picker-item-main">
        <span className="model-picker-item-name">{model.label}</span>
        <span className="model-picker-item-hint">{model.hint}</span>
      </span>
      {active && (
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}
