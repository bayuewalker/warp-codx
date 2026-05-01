// @vitest-environment happy-dom
/**
 * Task #39 — AppShell ↔ Sidebar paging integration.
 *
 * Pins the wiring that the route-level test in
 * `src/app/api/sessions/route.test.ts` cannot see:
 *   - the URL the client sends for the next page carries
 *     `before=<cursor>` (and `beforeId` when the server gave us one)
 *     plus `limit` matching `SESSIONS_PAGE_SIZE`
 *   - the new rows are appended to the existing list (not replaced)
 *   - duplicates are de-duped by id (defensive against a concurrent
 *     insert between page loads)
 *   - a second tap is blocked while a fetch is in flight (no second
 *     network request is sent)
 *
 * Heavy children (ChatArea, ConstitutionWarningBanner,
 * ConstitutionSettings) are stubbed so the test only exercises the
 * pagination flow. Supabase isn't touched.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("@/components/ChatArea", () => ({
  default: () => null,
}));
vi.mock("@/components/ConstitutionWarningBanner", () => ({
  default: () => null,
}));
vi.mock("@/components/ConstitutionSettings", () => ({
  default: () => null,
}));
// IssuesView / PRListView are mounted inside Sidebar but only render
// when the user switches view modes; we stay on "sessions" so they're
// inert. Stub them anyway to keep their module-level fetches from
// firing during render.
vi.mock("@/components/IssuesView", () => ({
  default: () => null,
}));
vi.mock("@/components/PRListView", () => ({
  default: () => null,
}));

import AppShell from "../AppShell";

type Session = {
  id: string;
  label: string;
  created_at: string;
  updated_at: string;
};

function makeSession(i: number): Session {
  // Stamp older as i grows so "page 2" rows look older than "page 1".
  const t = new Date(Date.UTC(2026, 0, 1, 12, 0, 0) - i * 60_000).toISOString();
  return {
    id: `s-${i}`,
    label: `Session ${i}`,
    created_at: t,
    updated_at: t,
  };
}

type PageResponse = {
  sessions: Session[];
  hasMore: boolean;
  nextCursor: string | null;
  nextCursorId: string | null;
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

type FetchSpy = {
  mockImplementation: (impl: typeof fetch) => unknown;
  mock: { calls: unknown[][] };
};

let fetchSpy: FetchSpy;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch") as unknown as FetchSpy;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Wait for the first-page fetch to have been issued and resolved so
 * the sessions list is rendered before we exercise the load-more flow.
 */
async function waitForFirstPage(label: string) {
  await waitFor(() => {
    expect(screen.getByText(label)).toBeTruthy();
  });
}

describe("AppShell — sidebar paging integration", () => {
  it("requests the next page with before=<cursor>&beforeId=<id>&limit=10 and appends the new rows", async () => {
    const firstPage: PageResponse = {
      sessions: [makeSession(1), makeSession(2)],
      hasMore: true,
      nextCursor: makeSession(2).created_at,
      nextCursorId: "s-2",
    };
    const secondPage: PageResponse = {
      sessions: [makeSession(3), makeSession(4)],
      hasMore: false,
      nextCursor: null,
      nextCursorId: null,
    };

    fetchSpy.mockImplementation((async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.startsWith("/api/sessions")) {
        if (url.includes("before=")) return jsonResponse(secondPage);
        return jsonResponse(firstPage);
      }
      return new Response("not mocked", { status: 404 });
    }) as typeof fetch);

    render(<AppShell />);
    await waitForFirstPage("Session 1");

    // Sanity — the first call is the initial unsorted fetch with no
    // cursor, just `limit`.
    const firstUrl = String(fetchSpy.mock.calls[0][0]);
    expect(firstUrl).toContain("/api/sessions?");
    expect(firstUrl).toContain("limit=10");
    expect(firstUrl).not.toContain("before=");

    // The Show more button should now be visible because hasMore=true.
    const showMore = await screen.findByRole("button", {
      name: /show 10 more sessions/i,
    });
    fireEvent.click(showMore);

    // Wait for the second fetch and the new rows to appear.
    await waitFor(() => {
      expect(screen.getByText("Session 3")).toBeTruthy();
    });

    // Verify the URL we asked for: before, beforeId, limit, all present
    // and correctly populated from the first-page cursor.
    const secondUrl = String(
      fetchSpy.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes("before="),
      )?.[0],
    );
    expect(secondUrl).toContain("limit=10");
    expect(secondUrl).toContain(
      `before=${encodeURIComponent(firstPage.nextCursor!)}`,
    );
    expect(secondUrl).toContain("beforeId=s-2");

    // Append, not replace — page-1 rows must still be in the DOM.
    expect(screen.getByText("Session 1")).toBeTruthy();
    expect(screen.getByText("Session 2")).toBeTruthy();
    expect(screen.getByText("Session 4")).toBeTruthy();

    // hasMore=false from the second page → button hides.
    expect(
      screen.queryByRole("button", { name: /show \d+ more sessions/i }),
    ).toBeNull();
  });

  it("de-dupes by id when a row from page 2 is already in the list", async () => {
    const firstPage: PageResponse = {
      sessions: [makeSession(1), makeSession(2)],
      hasMore: true,
      nextCursor: makeSession(2).created_at,
      nextCursorId: "s-2",
    };
    // Server returns s-2 again (e.g. another tab inserted a newer row
    // mid-paging and shifted the boundary). The client must keep
    // exactly one s-2 in the rendered list.
    const secondPage: PageResponse = {
      sessions: [makeSession(2), makeSession(3)],
      hasMore: false,
      nextCursor: null,
      nextCursorId: null,
    };

    fetchSpy.mockImplementation((async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.startsWith("/api/sessions")) {
        if (url.includes("before=")) return jsonResponse(secondPage);
        return jsonResponse(firstPage);
      }
      return new Response("not mocked", { status: 404 });
    }) as typeof fetch);

    render(<AppShell />);
    await waitForFirstPage("Session 1");

    fireEvent.click(
      await screen.findByRole("button", {
        name: /show 10 more sessions/i,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Session 3")).toBeTruthy();
    });

    // Exactly one row labelled "Session 2" — dedupe must happen.
    expect(screen.getAllByText("Session 2")).toHaveLength(1);
    // s-1 from page 1 and s-3 from page 2 are both present.
    expect(screen.getByText("Session 1")).toBeTruthy();
    expect(screen.getByText("Session 3")).toBeTruthy();
  });

  it("blocks a second tap while the first fetch is still in flight (only one page-2 request goes out)", async () => {
    const firstPage: PageResponse = {
      sessions: [makeSession(1), makeSession(2)],
      hasMore: true,
      nextCursor: makeSession(2).created_at,
      nextCursorId: "s-2",
    };
    const secondPage: PageResponse = {
      sessions: [makeSession(3)],
      hasMore: false,
      nextCursor: null,
      nextCursorId: null,
    };

    let resolveSecond: (r: Response) => void = () => {};
    const secondPromise = new Promise<Response>((res) => {
      resolveSecond = res;
    });

    fetchSpy.mockImplementation((async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.startsWith("/api/sessions")) {
        if (url.includes("before=")) {
          // Hold the response so we can inspect the in-flight state.
          return secondPromise;
        }
        return jsonResponse(firstPage);
      }
      return new Response("not mocked", { status: 404 });
    }) as typeof fetch);

    render(<AppShell />);
    await waitForFirstPage("Session 1");

    const showMore = await screen.findByRole("button", {
      name: /show 10 more sessions/i,
    });

    // Tap once — the request goes out and is now in flight.
    fireEvent.click(showMore);

    // Wait for the in-flight UI: button is disabled, label is Loading…
    await waitFor(() => {
      const btn = screen.getByRole("button", {
        name: /show 10 more sessions/i,
      }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toMatch(/loading/i);
    });

    // Tap a second (and third) time while still loading. The DOM-level
    // `disabled` blocks the click handler, and the AppShell-level
    // guard in `loadMoreSessions` would also short-circuit if it did
    // somehow fire. Either way, no extra fetch should leave the
    // browser.
    const beforeCount = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("before="),
    ).length;
    fireEvent.click(showMore);
    fireEvent.click(showMore);
    const afterCount = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("before="),
    ).length;
    expect(afterCount).toBe(beforeCount);
    expect(beforeCount).toBe(1);

    // Resolve the in-flight request and confirm the UI settles.
    await act(async () => {
      resolveSecond(jsonResponse(secondPage));
      await secondPromise;
    });

    await waitFor(() => {
      expect(screen.getByText("Session 3")).toBeTruthy();
    });
  });
});
