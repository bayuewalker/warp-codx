"use client";

import type { TodoItem } from "@/lib/section-parser";
import styles from "./sections.module.css";

interface TodosBlockProps {
  items: TodoItem[];
  title?: string;
}

/**
 * Pattern F — TODOS checklist block.
 * Header: "TODOS" pill + "N/total" count (teal when all done).
 * Each row: 20px circle (pending = empty border, done = filled teal ✓,
 * active = filled blue w/ white dot) + item text.
 * "Active" = first unchecked item when at least one item is already checked.
 */
export default function TodosBlock({ items }: TodosBlockProps) {
  if (items.length === 0) return null;

  const checkedCount = items.filter((it) => it.checked).length;
  const allDone = checkedCount === items.length;

  // Active = first unchecked item, but only if some items are already done
  const firstUncheckedIdx =
    checkedCount > 0 ? items.findIndex((it) => !it.checked) : -1;

  return (
    <div className={styles.card}>
      {/* Header */}
      <div className={styles.todosHeader}>
        <span
          className={`${styles.todosPill}${allDone ? ` ${styles.todosPillDone}` : ""}`}
        >
          TODOS
        </span>
        <span
          className={`${styles.todosCount}${allDone ? ` ${styles.todosCountDone}` : ""}`}
        >
          {checkedCount}/{items.length}
        </span>
      </div>

      {/* Item list */}
      <div className={styles.todosList}>
        {items.map((item, i) => {
          const isActive = i === firstUncheckedIdx;
          const isDone = item.checked;
          const isPending = !item.checked && !isActive;

          return (
            <div
              key={i}
              className={`${styles.todosItem}${isActive ? ` ${styles.todosItemActive}` : ""}`}
            >
              {/* Circle */}
              <div
                className={`${styles.todosCircle} ${
                  isDone
                    ? styles.todosCircleDone
                    : isActive
                      ? styles.todosCircleActive
                      : styles.todosCirclePending
                }`}
                aria-hidden="true"
              >
                {isDone && "✓"}
                {isActive && <div className={styles.todosActiveDot} />}
              </div>

              {/* Text */}
              <div
                className={`${styles.todosText} ${
                  isDone
                    ? styles.todosTextDone
                    : isPending
                      ? styles.todosTextPending
                      : ""
                }`}
              >
                {item.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
