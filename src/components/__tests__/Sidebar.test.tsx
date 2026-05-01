// @vitest-environment happy-dom
/**
 * Task #39 — Sidebar "Show more" affordance.
 * Task #40 — IntersectionObserver-driven auto-load sentinel.
 *
 * Pins the visible/hidden states of the load-more button, the
 * `loadMoreBatchSize` rendering in its label, the disabled+spinner
 * UI while a fetch is in flight, and the click → `onLoadMoreSessions`
 * wiring. If a future refactor regresses to client-side slicing, the
 * "hidden when hasMoreSessions=false" assertion will fail, and if the
 * disabled-during-loading guard disappears, the multi-click test
 * fails too.
 *
 * The Task #40 block at the bottom additionally pins:
 *   - the invisible sentinel is rendered alongside the fallback
 *     button when `hasMoreSessions` is true,
 *   - it isn't observed while a fetch is in flight (so the parent's
 *     in-flight guard isn't pummelled), and
 *   - intersecting the sentinel calls `onLoadMoreSessions` exactly
 *     once per intersection.
 *
 * The Sidebar itself does not fetch — the parent (`AppShell`) does.
 * The cursor parameter on the wire and append-with-dedupe behavior
 * are covered by `AppShell.pagination.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Sidebar from "../Sidebar";
import type { Session } from "@/lib/types";

/**
 * Minimal IntersectionObserver stub. happy-dom ships a no-op
 * constructor, but it never delivers entries — for these tests we
 * need to be able to fire `isIntersecting: true` on demand and to
 * count how many observers were created. We reset the registry
 * before each test so cases don't leak.
 */
type FakeObserver = {
  callback: IntersectionObserverCallback;
  targets: Element[];
  disconnect: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  trigger: (isIntersecting?: boolean) => void;
};

let observers: FakeObserver[] = [];
const OriginalIO = (globalThis as { IntersectionObserver?: unknown })
  .IntersectionObserver;

beforeEach(() => {
  observers = [];
  class MockIO {
    callback: IntersectionObserverCallback;
    targets: Element[] = [];
    disconnect = vi.fn(() => {
      this.targets = [];
    });
    unobserve = vi.fn((el: Element) => {
      this.targets = this.targets.filter((t) => t !== el);
    });
    constructor(cb: IntersectionObserverCallback) {
      this.callback = cb;
      const self = this;
      observers.push({
        get callback() {
          return self.callback;
        },
        get targets() {
          return self.targets;
        },
        disconnect: self.disconnect,
        unobserve: self.unobserve,
        trigger(isIntersecting = true) {
          const entries = self.targets.map((target) => ({
            target,
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
            time: 0,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
          })) as IntersectionObserverEntry[];
          self.callback(entries, self as unknown as IntersectionObserver);
        },
      });
    }
    observe(target: Element) {
      this.targets.push(target);
    }
    takeRecords() {
      return [];
    }
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    MockIO;
});

afterEach(() => {
  cleanup();
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    OriginalIO;
});

function makeSession(i: number): Session {
  const t = new Date(Date.UTC(2026, 0, 1, 12, 0, i)).toISOString();
  return {
    id: `s-${i}`,
    label: `Session ${i}`,
    created_at: t,
    updated_at: t,
  };
}

type Override = Partial<React.ComponentProps<typeof Sidebar>>;

function renderSidebar(over: Override = {}) {
  const onLoadMoreSessions = vi.fn();
  const onNewDirective = vi.fn();
  const onSelect = vi.fn();
  const onDelete = vi.fn();
  const onCloseDrawer = vi.fn();

  const props: React.ComponentProps<typeof Sidebar> = {
    sessions: [makeSession(1), makeSession(2)],
    activeId: "s-1",
    loading: false,
    error: null,
    creating: false,
    hasMoreSessions: false,
    loadingMoreSessions: false,
    loadMoreBatchSize: 10,
    onLoadMoreSessions,
    onNewDirective,
    onSelect,
    onDelete,
    onCloseDrawer,
    ...over,
  };

  const utils = render(<Sidebar {...props} />);
  return { ...utils, props };
}

describe("Sidebar — Show more affordance", () => {
  it("hides the Show more button when the server says hasMore=false", () => {
    renderSidebar({ hasMoreSessions: false });
    expect(
      screen.queryByRole("button", { name: /show \d+ more sessions/i }),
    ).toBeNull();
    // And the row list is rendered so we know the button is absent on
    // purpose, not because the list itself is hidden.
    expect(screen.getByText("Session 1")).not.toBeNull();
  });

  it("shows the Show more button with the batch size in its label when hasMore=true", () => {
    renderSidebar({ hasMoreSessions: true, loadMoreBatchSize: 10 });
    const btn = screen.getByRole("button", {
      name: /show 10 more sessions/i,
    });
    expect(btn).not.toBeNull();
    // Visible label uses the same N as the aria-label so the affordance
    // reads the same way it did before pagination.
    expect(btn.textContent).toMatch(/show 10 more/i);
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("respects loadMoreBatchSize so a different page size still reads correctly", () => {
    renderSidebar({ hasMoreSessions: true, loadMoreBatchSize: 25 });
    const btn = screen.getByRole("button", {
      name: /show 25 more sessions/i,
    });
    expect(btn.textContent).toMatch(/show 25 more/i);
  });

  it("calls onLoadMoreSessions exactly once per tap", () => {
    const { props } = renderSidebar({ hasMoreSessions: true });
    const btn = screen.getByRole("button", {
      name: /show \d+ more sessions/i,
    });
    fireEvent.click(btn);
    expect(props.onLoadMoreSessions).toHaveBeenCalledTimes(1);
  });

  it("disables the button and shows Loading… while a fetch is in flight", () => {
    renderSidebar({
      hasMoreSessions: true,
      loadingMoreSessions: true,
    });
    const btn = screen.getByRole("button", {
      name: /show \d+ more sessions/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/loading/i);
  });

  it("blocks a second tap while the first fetch is still in flight", () => {
    const { props } = renderSidebar({
      hasMoreSessions: true,
      loadingMoreSessions: true,
    });
    const btn = screen.getByRole("button", {
      name: /show \d+ more sessions/i,
    });
    fireEvent.click(btn);
    fireEvent.click(btn);
    // The button is `disabled`; React/DOM will not dispatch click
    // handlers on a disabled <button>. If a future refactor drops the
    // `disabled` binding, this assertion will fail loudly.
    expect(props.onLoadMoreSessions).not.toHaveBeenCalled();
  });

  it("does not render the affordance while the initial sessions request is loading", () => {
    renderSidebar({
      loading: true,
      sessions: [],
      hasMoreSessions: true,
    });
    expect(
      screen.queryByRole("button", { name: /show \d+ more sessions/i }),
    ).toBeNull();
    expect(screen.getByText(/loading/i)).not.toBeNull();
  });

  it("does not render the affordance when there are zero sessions", () => {
    renderSidebar({
      sessions: [],
      hasMoreSessions: true,
    });
    expect(
      screen.queryByRole("button", { name: /show \d+ more sessions/i }),
    ).toBeNull();
  });
});

describe("Sidebar — Task #40 auto-load sentinel", () => {
  it("renders the sentinel alongside the fallback button when there are more sessions", () => {
    renderSidebar({ hasMoreSessions: true });
    const sentinel = screen.getByTestId("sessions-load-more-sentinel");
    expect(sentinel).not.toBeNull();
    // The fallback button must remain mounted for keyboard users.
    expect(
      screen.getByRole("button", { name: /show \d+ more sessions/i }),
    ).not.toBeNull();
    // And the sentinel is invisible to assistive tech.
    expect(sentinel.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not render the sentinel when there are no more sessions", () => {
    renderSidebar({ hasMoreSessions: false });
    expect(screen.queryByTestId("sessions-load-more-sentinel")).toBeNull();
  });

  it("registers exactly one IntersectionObserver against the sentinel when hasMore=true", () => {
    renderSidebar({ hasMoreSessions: true });
    expect(observers).toHaveLength(1);
    const sentinel = screen.getByTestId("sessions-load-more-sentinel");
    expect(observers[0].targets).toContain(sentinel);
  });

  it("does not register an observer while a fetch is already in flight", () => {
    // The fallback button has its own disabled-while-loading guard
    // (covered above). The auto-load path needs the same protection
    // so the parent isn't pummelled by repeated intersections during
    // a slow fetch.
    renderSidebar({ hasMoreSessions: true, loadingMoreSessions: true });
    expect(observers).toHaveLength(0);
  });

  it("calls onLoadMoreSessions when the sentinel scrolls into view", () => {
    const { props } = renderSidebar({ hasMoreSessions: true });
    expect(props.onLoadMoreSessions).not.toHaveBeenCalled();
    observers[0].trigger(true);
    expect(props.onLoadMoreSessions).toHaveBeenCalledTimes(1);
  });

  it("does not call onLoadMoreSessions when the sentinel leaves the viewport", () => {
    const { props } = renderSidebar({ hasMoreSessions: true });
    observers[0].trigger(false);
    expect(props.onLoadMoreSessions).not.toHaveBeenCalled();
  });

  it("re-firing the same observer twice still relies on the parent's in-flight guard", () => {
    // The observer can re-fire if the sentinel briefly leaves and
    // re-enters the viewport. The Sidebar forwards each intersection
    // to `onLoadMoreSessions`; the parent (`AppShell.loadMoreSessions`)
    // owns the in-flight dedupe (covered by AppShell.pagination tests).
    // What we pin here is that the Sidebar doesn't *swallow* the
    // second call — that would mask regressions in the parent guard.
    const { props } = renderSidebar({ hasMoreSessions: true });
    observers[0].trigger(true);
    observers[0].trigger(true);
    expect(props.onLoadMoreSessions).toHaveBeenCalledTimes(2);
  });

  it("disconnects the observer when the sessions list reports no more pages", () => {
    const { rerender, props } = renderSidebar({ hasMoreSessions: true });
    expect(observers).toHaveLength(1);
    const initialObserver = observers[0];

    rerender(
      <Sidebar
        {...props}
        hasMoreSessions={false}
      />,
    );

    expect(initialObserver.disconnect).toHaveBeenCalled();
    // And the sentinel itself is gone from the DOM.
    expect(screen.queryByTestId("sessions-load-more-sentinel")).toBeNull();
  });

  it("disconnects (and pauses) the observer while a load is in flight, then re-attaches when it settles", () => {
    const { rerender, props } = renderSidebar({ hasMoreSessions: true });
    const first = observers[0];
    expect(first).toBeDefined();

    // Parent reports a fetch is in flight — observer should detach so
    // it doesn't keep firing while we wait for the response.
    rerender(
      <Sidebar
        {...props}
        hasMoreSessions={true}
        loadingMoreSessions={true}
      />,
    );
    expect(first.disconnect).toHaveBeenCalled();

    // Fetch finishes, parent reports a new page is available — a
    // fresh observer is wired up so the user can keep scrolling.
    rerender(
      <Sidebar
        {...props}
        hasMoreSessions={true}
        loadingMoreSessions={false}
      />,
    );
    expect(observers.length).toBeGreaterThanOrEqual(2);
    const latest = observers[observers.length - 1];
    const sentinel = screen.getByTestId("sessions-load-more-sentinel");
    expect(latest.targets).toContain(sentinel);
  });

  it("renders the Task #41 end-of-history line once the sentinel/button is gone", () => {
    // When pagination has reached the oldest session the parent flips
    // `hasMoreSessions` to false. The sentinel and the fallback button
    // both disappear; the end-of-history line replaces them so the
    // user knows the silent disappearance wasn't a still-loading
    // state.
    renderSidebar({ hasMoreSessions: false });
    expect(screen.queryByTestId("sessions-load-more-sentinel")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /show \d+ more sessions/i }),
    ).toBeNull();
    const eol = screen.getByTestId("sessions-end-of-history");
    expect(eol).not.toBeNull();
    expect(eol.textContent).toMatch(/end of history/i);
  });

  it("hides the end-of-history line while there are still more pages to load", () => {
    // While `hasMoreSessions` is true we want the user to keep seeing
    // the load-more affordance, not a contradicting "end of history"
    // copy below it.
    renderSidebar({ hasMoreSessions: true });
    expect(screen.queryByTestId("sessions-end-of-history")).toBeNull();
  });

  it("hides the end-of-history line when there are zero sessions", () => {
    // The empty-state copy ("No sessions yet…") already explains the
    // empty list — adding "End of history" on top would read as
    // double-negative noise.
    renderSidebar({ sessions: [], hasMoreSessions: false });
    expect(screen.queryByTestId("sessions-end-of-history")).toBeNull();
  });

  it("hides the end-of-history line while the initial sessions request is loading", () => {
    // During the very first fetch the list itself is replaced by a
    // "Loading…" placeholder; we don't want the end-of-history line
    // peeking out underneath it.
    renderSidebar({ loading: true, sessions: [], hasMoreSessions: false });
    expect(screen.queryByTestId("sessions-end-of-history")).toBeNull();
  });

  it("falls back gracefully when IntersectionObserver is unavailable in the environment", () => {
    // Some older browsers / assistive contexts don't ship
    // IntersectionObserver. The sentinel should still render (so the
    // DOM stays predictable) and the fallback button is still
    // clickable — that's the entire reason we kept it.
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      undefined;

    const { props } = renderSidebar({ hasMoreSessions: true });
    expect(observers).toHaveLength(0);
    expect(screen.getByTestId("sessions-load-more-sentinel")).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /show \d+ more sessions/i }),
    );
    expect(props.onLoadMoreSessions).toHaveBeenCalledTimes(1);
  });
});
