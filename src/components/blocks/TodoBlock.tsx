"use client";

import type { TodosPayload } from "@/lib/types";

type Props = {
  payload: TodosPayload;
};

export default function TodoBlock({ payload }: Props) {
  const total = payload.total ?? payload.items.length;
  const done =
    payload.done ?? payload.items.filter((i) => i.state === "done").length;

  return (
    <div className="todo-block">
      <div className="todo-block-header">
        <span className="todo-tag">TODOS</span>
        <span className="todo-progress-text">
          <span className="done">{done}</span>/{total}
        </span>
      </div>
      <ul className="todo-list">
        {payload.items.map((item, i) => (
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
    </div>
  );
}
