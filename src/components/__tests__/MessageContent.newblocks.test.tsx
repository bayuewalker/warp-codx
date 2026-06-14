// @vitest-environment happy-dom
/**
 * WARP/ui-polish — new response-rendering blocks. Verifies that the
 * terminal / command / callout / json / file fences extract and mount
 * as their dedicated cards (never leaking raw JSON into prose).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import MessageContent from "../MessageContent";

afterEach(cleanup);

const fence = (lang: string, payload: unknown) =>
  ["```" + lang, JSON.stringify(payload), "```"].join("\n");

describe("MessageContent new rich blocks", () => {
  it("renders a terminal block with auto-detected status colours", () => {
    const content = fence("warp-terminal", {
      title: "BUILD",
      lines: [
        { text: "$ npm run build" },
        { text: "✓ Build completed" },
        { text: "✕ Type check failed" },
      ],
    });
    const { container } = render(
      <MessageContent role="assistant" content={content} />,
    );

    expect(container.querySelector(".term-block")).not.toBeNull();
    // $ prompt → input, ✓ → ok, ✕ → err (auto-detected, no explicit type)
    expect(container.querySelector(".term-line--in")).not.toBeNull();
    expect(container.querySelector(".term-line--ok")).not.toBeNull();
    expect(container.querySelector(".term-line--err")).not.toBeNull();
    // Raw JSON must not leak into prose.
    expect(container.textContent).not.toContain("\"lines\"");
  });

  it("renders a command block with one row per command", () => {
    const content = fence("warp-command", {
      commands: ["git checkout main", "git pull"],
    });
    const { container } = render(
      <MessageContent role="assistant" content={content} />,
    );
    expect(container.querySelector(".cmd-block")).not.toBeNull();
    expect(container.querySelectorAll(".cmd-line")).toHaveLength(2);
    expect(screen.getByText("git checkout main")).toBeTruthy();
  });

  it("renders a callout with the kind modifier class", () => {
    const content = fence("warp-callout", {
      kind: "error",
      title: "Merge blocked",
    });
    const { container } = render(
      <MessageContent role="assistant" content={content} />,
    );
    expect(container.querySelector(".callout--error")).not.toBeNull();
    expect(screen.getByText("Merge blocked")).toBeTruthy();
  });

  it("renders a json tree instead of raw JSON prose", () => {
    const content = fence("warp-json", {
      title: "RESPONSE",
      data: { status: "ok", count: 1 },
    });
    const { container } = render(
      <MessageContent role="assistant" content={content} />,
    );
    expect(container.querySelector(".json-block")).not.toBeNull();
    expect(container.querySelector(".json-key")).not.toBeNull();
    // Keys render as styled spans, not a literal stringified object.
    expect(screen.getByText("status")).toBeTruthy();
  });

  it("renders a file output card with name and size", () => {
    const content = fence("warp-file", {
      name: "REPORT.md",
      size: "12.4 KB",
      path: "reports/REPORT.md",
      content: "# Report",
    });
    const { container } = render(
      <MessageContent role="assistant" content={content} />,
    );
    expect(container.querySelector(".file-block")).not.toBeNull();
    expect(screen.getByText("REPORT.md")).toBeTruthy();
    expect(screen.getByText("12.4 KB")).toBeTruthy();
    // Content-backed file exposes Open + Download + Copy path.
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Download")).toBeTruthy();
  });

  it("collapses a run of new blocks behind one Working section", () => {
    const content = [
      "Done.",
      "",
      fence("warp-callout", { kind: "success", title: "Built" }),
      "",
      fence("warp-terminal", { lines: [{ text: "$ ok" }] }),
    ].join("\n");
    const { container } = render(
      <MessageContent role="assistant" content={content} />,
    );
    const collapsibles = container.querySelectorAll(".warp-collapsible");
    expect(collapsibles).toHaveLength(1);
    expect(collapsibles[0].querySelector(".callout")).not.toBeNull();
    expect(collapsibles[0].querySelector(".term-block")).not.toBeNull();
  });
});
