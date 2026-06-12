// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  applyDisplayPrefs,
  getFontPref,
  getTextSize,
  setFontPref,
  setTextSize,
} from "./display-prefs";

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.textsize;
  delete document.documentElement.dataset.fontpref;
});

describe("display-prefs", () => {
  it("defaults to medium / inter", () => {
    expect(getTextSize()).toBe("medium");
    expect(getFontPref()).toBe("inter");
  });

  it("persists and applies a text size as an <html> data attribute", () => {
    setTextSize("big");
    expect(getTextSize()).toBe("big");
    expect(document.documentElement.dataset.textsize).toBe("big");

    setTextSize("small");
    expect(document.documentElement.dataset.textsize).toBe("small");

    // medium is the default → attribute removed, not set to "medium"
    setTextSize("medium");
    expect(document.documentElement.dataset.textsize).toBeUndefined();
  });

  it("persists and applies a font pref", () => {
    setFontPref("mono");
    expect(getFontPref()).toBe("mono");
    expect(document.documentElement.dataset.fontpref).toBe("mono");

    setFontPref("inter");
    expect(document.documentElement.dataset.fontpref).toBeUndefined();
  });

  it("ignores garbage in localStorage", () => {
    window.localStorage.setItem("warp_text_size", "gigantic");
    window.localStorage.setItem("warp_font_pref", "comic-sans");
    expect(getTextSize()).toBe("medium");
    expect(getFontPref()).toBe("inter");
    applyDisplayPrefs();
    expect(document.documentElement.dataset.textsize).toBeUndefined();
    expect(document.documentElement.dataset.fontpref).toBeUndefined();
  });
});
