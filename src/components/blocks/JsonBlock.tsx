"use client";

import { useCallback, useMemo, useState } from "react";
import type { JsonPayload } from "@/lib/types";
import { copyToClipboard } from "@/lib/chat-export";

type Props = {
  payload: JsonPayload;
};

/**
 * Dedicated JSON renderer — a collapsible, syntax-coloured tree so the
 * assistant never has to dump raw JSON into prose. Objects and arrays
 * fold/unfold per node; leaves are coloured by type. A header "Copy"
 * grabs the pretty-printed source.
 */
export default function JsonBlock({ payload }: Props) {
  const [copied, setCopied] = useState(false);
  const title = payload.title?.trim() || "JSON";

  const pretty = useMemo(() => {
    try {
      return JSON.stringify(payload.data, null, 2);
    } catch {
      return String(payload.data);
    }
  }, [payload.data]);

  const handleCopy = useCallback(() => {
    copyToClipboard(pretty).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [pretty]);

  return (
    <div className="json-block">
      <div className="json-header">
        <span className="json-title">{title}</span>
        <button type="button" className="json-copy" onClick={handleCopy}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <div className="json-scroll">
        <div className="json-tree">
          <JsonNode
            value={payload.data}
            depth={0}
            defaultOpen={!payload.collapsed}
            isLast
          />
        </div>
      </div>
    </div>
  );
}

type NodeProps = {
  /** Optional object key / array index label shown before the value. */
  label?: string;
  value: unknown;
  depth: number;
  defaultOpen: boolean;
  /** Suppress the trailing comma on the final sibling. */
  isLast: boolean;
};

function JsonNode({ label, value, depth, defaultOpen, isLast }: NodeProps) {
  const isObject = value !== null && typeof value === "object";
  const [open, setOpen] = useState(defaultOpen || depth === 0);

  // Leaf — render the scalar coloured by type.
  if (!isObject) {
    return (
      <div className="json-row" style={{ paddingLeft: depth * 14 }}>
        {label !== undefined && <span className="json-key">{label}</span>}
        {label !== undefined && <span className="json-punct">: </span>}
        <Scalar value={value} />
        {!isLast && <span className="json-punct">,</span>}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const open$ = isArray ? "[" : "{";
  const close$ = isArray ? "]" : "}";
  const count = entries.length;

  return (
    <div className="json-node">
      <button
        type="button"
        className="json-row json-row--toggle"
        style={{ paddingLeft: depth * 14 }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`json-chev${open ? " open" : ""}`} aria-hidden="true">
          ▸
        </span>
        {label !== undefined && <span className="json-key">{label}</span>}
        {label !== undefined && <span className="json-punct">: </span>}
        <span className="json-punct">{open$}</span>
        {!open && (
          <span className="json-collapsed">
            {count === 0 ? "" : `… ${count} `}
            <span className="json-punct">{close$}</span>
            {!isLast && <span className="json-punct">,</span>}
          </span>
        )}
      </button>
      {open && (
        <>
          {entries.map(([k, v], i) => (
            <JsonNode
              key={k}
              label={isArray ? undefined : k}
              value={v}
              depth={depth + 1}
              defaultOpen={defaultOpen}
              isLast={i === entries.length - 1}
            />
          ))}
          <div className="json-row" style={{ paddingLeft: depth * 14 }}>
            <span className="json-punct">{close$}</span>
            {!isLast && <span className="json-punct">,</span>}
          </div>
        </>
      )}
    </div>
  );
}

function Scalar({ value }: { value: unknown }) {
  if (value === null) return <span className="json-null">null</span>;
  switch (typeof value) {
    case "string":
      return <span className="json-str">&quot;{value}&quot;</span>;
    case "number":
      return <span className="json-num">{String(value)}</span>;
    case "boolean":
      return <span className="json-bool">{String(value)}</span>;
    default:
      return <span className="json-str">{String(value)}</span>;
  }
}
