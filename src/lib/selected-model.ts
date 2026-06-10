"use client";

/**
 * Shared client state for the user's selected chat model.
 *
 * Persisted in localStorage and broadcast via a window event so the composer
 * picker (ChatInput), the send path (ChatArea), and the status strip
 * (ProviderStatusBar) all stay in sync without prop drilling. Defaults to
 * "auto" — coding routes to Sonnet, plain chat to GPT-4o.
 */
import { useEffect, useState } from "react";
import { isSelectableModelId, type SelectableModelId } from "./models";

const KEY = "warp_selected_model";
const EVENT = "warp:selected-model";

export function getSelectedModelId(): SelectableModelId {
  if (typeof window === "undefined") return "auto";
  const v = window.localStorage.getItem(KEY);
  return isSelectableModelId(v) ? v : "auto";
}

export function setSelectedModelId(id: SelectableModelId) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, id);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id } }));
}

export function useSelectedModel(): [
  SelectableModelId,
  (id: SelectableModelId) => void,
] {
  const [id, setId] = useState<SelectableModelId>("auto");

  useEffect(() => {
    setId(getSelectedModelId());
    const onEvent = (e: Event) => {
      const next = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (isSelectableModelId(next)) setId(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && isSelectableModelId(e.newValue)) setId(e.newValue);
    };
    window.addEventListener(EVENT, onEvent);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onEvent);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return [id, setSelectedModelId];
}
