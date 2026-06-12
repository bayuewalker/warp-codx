// @vitest-environment happy-dom
/**
 * Tests for the ⌘K command palette: opens on ⌘K, fuzzy filter, ↑↓+Enter
 * keyboard nav, click invocation, model + session dispatch. The portal
 * mounts into document.body in happy-dom; queries against `document` see
 * it just fine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import CommandPalette, {
  OPEN_PALETTE_EVENT,
  type PaletteAction,
} from "../CommandPalette";

vi.mock("@/lib/selected-model", () => ({
  useSelectedModel: () => ["auto", vi.fn()] as const,
}));

const sessions = [
  {
    id: "sess-1",
    label: "Refactor billing flow",
    created_at: "2026-06-12T10:00:00Z",
    updated_at: "2026-06-12T10:00:00Z",
  },
  {
    id: "sess-2",
    label: "Plan onboarding redesign",
    created_at: "2026-06-12T09:00:00Z",
    updated_at: "2026-06-12T09:00:00Z",
  },
];

function renderPalette(opts: { open?: boolean; isAdmin?: boolean } = {}) {
  const onAction = vi.fn<(a: PaletteAction) => void>();
  const onClose = vi.fn();
  const utils = render(
    <CommandPalette
      sessions={sessions}
      activeSessionId="sess-1"
      isAdmin={opts.isAdmin ?? false}
      onAction={onAction}
      open={opts.open ?? true}
      onClose={onClose}
    />,
  );
  return { ...utils, onAction, onClose };
}

beforeEach(() => {
  // Each test gets a fresh body so the portal's previous instance is gone.
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CommandPalette", () => {
  it("renders the default action rows and the supplied sessions", () => {
    renderPalette();
    expect(screen.getByLabelText("Command palette")).toBeTruthy();
    expect(screen.getByText("New directive")).toBeTruthy();
    expect(screen.getByText("Open settings")).toBeTruthy();
    // Admin-only items are hidden by default.
    expect(screen.queryByText("Refresh constitution")).toBeNull();
    expect(screen.getByText("Refactor billing flow")).toBeTruthy();
    expect(screen.getByText("Plan onboarding redesign")).toBeTruthy();
  });

  it("shows admin-only actions when isAdmin=true", () => {
    renderPalette({ isAdmin: true });
    expect(screen.getByText("Refresh constitution")).toBeTruthy();
    expect(screen.getByText("Launch agent")).toBeTruthy();
  });

  it("fuzzy-filters rows by the search input", () => {
    renderPalette();
    const search = screen.getByLabelText("Command palette search");
    fireEvent.change(search, { target: { value: "onbrd" } });
    // "Plan onboarding redesign" matches o→n→b→r→d subsequence.
    expect(screen.queryByText("Plan onboarding redesign")).toBeTruthy();
    // "Refactor billing flow" does not.
    expect(screen.queryByText("Refactor billing flow")).toBeNull();
  });

  it("invokes onAction with open-session on click", () => {
    const { onAction, onClose } = renderPalette();
    fireEvent.click(screen.getByText("Plan onboarding redesign"));
    expect(onAction).toHaveBeenCalledWith({
      kind: "open-session",
      sessionId: "sess-2",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("ArrowDown + Enter activates the next row", () => {
    const { onAction } = renderPalette();
    const search = screen.getByLabelText("Command palette search");
    // First row is "New directive". One ArrowDown → "Open settings".
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onAction).toHaveBeenCalledWith({ kind: "open-settings" });
  });

  it("opens via the ⌘K shortcut when the parent listens to OPEN_PALETTE_EVENT", () => {
    // Render with open=false; simulate the global ⌘K and verify the event
    // fires so the parent can flip its open state.
    const listener = vi.fn();
    window.addEventListener(OPEN_PALETTE_EVENT, listener);
    renderPalette({ open: false });
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(listener).toHaveBeenCalled();
    window.removeEventListener(OPEN_PALETTE_EVENT, listener);
  });

  it("Esc closes the palette", () => {
    const { onClose } = renderPalette();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("dispatches select-model when a model row is chosen", () => {
    const { onAction } = renderPalette();
    fireEvent.click(screen.getByText("Claude Sonnet 4.6"));
    expect(onAction).toHaveBeenCalledWith({
      kind: "select-model",
      modelId: "sonnet",
    });
  });

  it("shows a friendly empty state when no rows match", () => {
    renderPalette();
    fireEvent.change(screen.getByLabelText("Command palette search"), {
      target: { value: "zzz no match zzz" },
    });
    expect(screen.getByText("No matching command.")).toBeTruthy();
  });
});
