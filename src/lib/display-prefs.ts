"use client";

/**
 * Per-device display preferences — chat text size and prose font.
 *
 * Stored in localStorage (these are device-level reading preferences,
 * not workspace data), applied as data attributes on <html> so CSS in
 * globals.css can switch the chat surface:
 *
 *   html[data-textsize="small" | "big"]  → zoom on the message feed
 *   html[data-fontpref="system" | "mono"] → prose font override
 *
 * "medium" / "inter" are the defaults and render with no attribute.
 * A storage event listener keeps multiple tabs in sync; same-tab
 * updates are pushed through a CustomEvent so React state can follow.
 */

import { useEffect, useState } from "react";

export type TextSize = "small" | "medium" | "big";
export type FontPref = "inter" | "system" | "mono";

const SIZE_KEY = "warp_text_size";
const FONT_KEY = "warp_font_pref";
const CHANGE_EVENT = "warp-display-prefs";

const SIZES: readonly TextSize[] = ["small", "medium", "big"];
const FONTS: readonly FontPref[] = ["inter", "system", "mono"];

export function getTextSize(): TextSize {
  if (typeof window === "undefined") return "medium";
  const v = window.localStorage.getItem(SIZE_KEY);
  return SIZES.includes(v as TextSize) ? (v as TextSize) : "medium";
}

export function getFontPref(): FontPref {
  if (typeof window === "undefined") return "inter";
  const v = window.localStorage.getItem(FONT_KEY);
  return FONTS.includes(v as FontPref) ? (v as FontPref) : "inter";
}

export function setTextSize(size: TextSize) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SIZE_KEY, size);
  applyDisplayPrefs();
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function setFontPref(font: FontPref) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FONT_KEY, font);
  applyDisplayPrefs();
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Write the current prefs onto <html> as data attributes. */
export function applyDisplayPrefs() {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const size = getTextSize();
  const font = getFontPref();
  if (size === "medium") delete el.dataset.textsize;
  else el.dataset.textsize = size;
  if (font === "inter") delete el.dataset.fontpref;
  else el.dataset.fontpref = font;
}

/** Reactive read of both prefs — re-renders on set() and cross-tab changes. */
export function useDisplayPrefs(): { textSize: TextSize; fontPref: FontPref } {
  const [textSize, setSize] = useState<TextSize>("medium");
  const [fontPref, setFont] = useState<FontPref>("inter");

  useEffect(() => {
    const sync = () => {
      setSize(getTextSize());
      setFont(getFontPref());
    };
    sync();
    applyDisplayPrefs();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return { textSize, fontPref };
}
