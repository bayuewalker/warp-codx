"use client";

import { useState } from "react";
import type { TodosPayload } from "@/lib/types";
import CollapsibleBlock from "./CollapsibleBlock";

type Props = {
  payload: TodosPayload;
};

const TODO_VISIBLE_WHEN_COLLAPSED = 3;

export default function TodoBlock({ payload }: Props) {
  const total = payload.total ?? payload.items.length;
  const done =
    payload.done ?? payload.items.filter((i) => i.state === "done").length;

  const overflows = payload.items.length > TODO_VISIBLE_WHEN_COLLAPSED;
  const [expanded, setExpanded] = useState(!overflows);

  const visibleItems =
    overflows && !expanded
      ? payload.items.slice(0, TODO_VISIBLE_WHEN_COLLAPSED)
      : payload.items;

  const hiddenCount = payload.items.length - TODO_VISIBLE_WHEN_COLLAPSED;

  const header = (
    <>
      <span className="todo-tag">TODOS</span>
    </>
  );

  const pill = (
    <span className="todo-progress-text">
      <span className="done">{done}</span>/{total}
    </span>
  );

  return (
    <CollapsibleBlock
      className="todo-block"
      headerClassName="block-summary todo-block-header"
      header={header}
      pill={pill}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      partialFooterLabel={overflows ? `Show ${hiddenCount} more` : undefined}
    >
      <ul className="todo-list">
        {visibleItems.map((item, i) => (
          <li
            key={item.id ?? i}
            className={`todo-item ${item.state}`}
          >
            <div className="todo-icon">
              {item.state === "done" ? (
                <div className="todo-icon-done" aria-hidden="true">
                  ✓
                </div>
              ) : item.state === "active" ? (
                <div className="todo-icon-active" aria-hidden="true" />
              ) : (
                <div className="todo-icon-empty" aria-hidden="true" />
              )}
            </div>
            <div className="todo-text-block">
              <div className="todo-text">{item.text}</div>
              {item.subtext && (
                <div className="todo-subtext">{item.subtext}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </CollapsibleBlock>
  );
}
