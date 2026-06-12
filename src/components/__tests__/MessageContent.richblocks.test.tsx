// @vitest-environment happy-dom
/**
 * Rich-block interleaving — pins the Ona-style transcript layout:
 *   - a lone `warp-*` fence renders as a card exactly where the fence
 *     sat between prose paragraphs (NOT pushed to the bottom)
 *   - a consecutive run of 2+ fences collapses behind a single
 *     "Working — N actions" CollapsibleSection
 *   - prose on either side of a run stays outside the collapsible
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import MessageContent from "../MessageContent";

afterEach(cleanup);

const action = (summary: string) =>
  ["```warp-action", JSON.stringify({ summary }), "```"].join("\n");

describe("MessageContent rich-block interleaving", () => {
  it("renders a lone action card between the prose that surrounds it", () => {
    const content = ["Before text.", "", action("Ran the build"), "", "After text."].join("\n");
    const { container } = render(
      <MessageContent role="assistant" content={content} />,
    );

    const root = container.querySelector(".message-content");
    expect(root).not.toBeNull();
    const children = Array.from(root!.children);
    const textOf = (el: Element) => el.textContent ?? "";

    const beforeIdx = children.findIndex((c) => textOf(c).includes("Before text."));
    const cardIdx = children.findIndex((c) => c.classList.contains("action-card"));
    const afterIdx = children.findIndex((c) => textOf(c).includes("After text."));

    expect(beforeIdx).toBeGreaterThanOrEqual(0);
    expect(cardIdx).toBeGreaterThan(beforeIdx);
    expect(afterIdx).toBeGreaterThan(cardIdx);
    // No collapsible wrapper for a single block.
    expect(container.querySelector(".warp-collapsible")).toBeNull();
  });

  it("collapses a consecutive run of 2+ blocks behind one section", () => {
    const content = [
      "Intro.",
      "",
      action("Step one"),
      "",
      action("Step two"),
      "",
      "Outro.",
    ].join("\n");
    const { container } = render(
      <MessageContent role="assistant" content={content} />,
    );

    const collapsibles = container.querySelectorAll(".warp-collapsible");
    expect(collapsibles).toHaveLength(1);
    expect(screen.getByText(/2 actions/i)).toBeTruthy();
    // Both cards live INSIDE the collapsible; prose stays outside it.
    expect(collapsibles[0].querySelectorAll(".action-card")).toHaveLength(2);
    expect(collapsibles[0].textContent).not.toContain("Intro.");
    expect(collapsibles[0].textContent).not.toContain("Outro.");
  });

  it("keeps two runs separated by prose as independent groups", () => {
    const content = [
      action("A1"),
      "",
      action("A2"),
      "",
      "Middle narration.",
      "",
      action("B1"),
    ].join("\n");
    const { container } = render(
      <MessageContent role="assistant" content={content} />,
    );

    // First run (2 blocks) collapses; second run is a lone inline card.
    expect(container.querySelectorAll(".warp-collapsible")).toHaveLength(1);
    const allCards = container.querySelectorAll(".action-card");
    expect(allCards).toHaveLength(3);
    const loneCard = Array.from(allCards).find(
      (c) => !c.closest(".warp-collapsible"),
    );
    expect(loneCard?.textContent).toContain("B1");
  });
});
