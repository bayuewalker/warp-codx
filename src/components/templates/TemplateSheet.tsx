"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  TEMPLATES,
  formatTemplateOutput,
  type TemplateType,
  type TemplateField,
} from "./templates.config";
import "./template-sheet.css";

interface TemplateSheetProps {
  open: boolean;
  onClose: () => void;
  onCompose: (markdown: string) => void;
}

export default function TemplateSheet({
  open,
  onClose,
  onCompose,
}: TemplateSheetProps) {
  const [selectedType, setSelectedType] = useState<TemplateType | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // Element that opened the sheet, so we can restore focus on close.
  const triggerRef = useRef<HTMLElement | null>(null);

  // Reset internal state every time the sheet closes so the next open
  // shows the picker, not the last form view.
  useEffect(() => {
    if (!open) {
      setSelectedType(null);
      setFormValues({});
    }
  }, [open]);

  // Capture the focused element when opening and restore it on close.
  useEffect(() => {
    if (open) {
      if (typeof document !== "undefined") {
        triggerRef.current = document.activeElement as HTMLElement | null;
      }
      // Move focus into the dialog after the next paint so the focusable
      // children exist.
      requestAnimationFrame(() => {
        const root = sheetRef.current;
        if (!root) return;
        const first = root.querySelector<HTMLElement>(
          'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])',
        );
        first?.focus();
      });
      return;
    }
    // Restore focus to the trigger.
    if (triggerRef.current && typeof triggerRef.current.focus === "function") {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [open]);

  // Close on Escape for desktop testers; the backdrop covers mobile.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const selectedDef = selectedType
    ? TEMPLATES.find((t) => t.type === selectedType) ?? null
    : null;

  const handleSelect = (type: TemplateType) => {
    const def = TEMPLATES.find((t) => t.type === type);
    const defaults: Record<string, string> = {};
    def?.fields.forEach((f) => {
      if (f.default) defaults[f.name] = f.default;
    });
    setFormValues(defaults);
    setSelectedType(type);
  };

  const handleBack = () => {
    setSelectedType(null);
    setFormValues({});
  };

  const requiredFilled = selectedDef
    ? selectedDef.fields
        .filter((f) => f.required)
        .every((f) => (formValues[f.name] ?? "").trim().length > 0)
    : false;

  const handleCompose = () => {
    if (!selectedDef || !requiredFilled) return;
    const markdown = formatTemplateOutput(selectedDef.type, formValues);
    onCompose(markdown);
    onClose();
  };

  return (
    <>
      <div
        className="ts-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className="ts-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={selectedDef ? `${selectedDef.label} template` : "Templates"}
      >
        <div className="ts-handle" aria-hidden="true" />
        <div className="ts-header">
          <span className="ts-title">
            {selectedDef ? selectedDef.label : "Templates"}
          </span>
          <button
            type="button"
            className="ts-close"
            onClick={onClose}
            aria-label="Close templates"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="ts-body warp-scroll">
          {!selectedDef && (
            <div className="ts-grid">
              {TEMPLATES.map((t) => (
                <button
                  key={t.type}
                  type="button"
                  className="ts-card"
                  onClick={() => handleSelect(t.type)}
                >
                  <span className="ts-card-label">{t.label}</span>
                  <span className="ts-card-desc">{t.description}</span>
                  <span className="ts-card-agent">{t.agent}</span>
                </button>
              ))}
            </div>
          )}

          {selectedDef && (
            <div className="ts-form">
              <button
                type="button"
                className="ts-back"
                onClick={handleBack}
              >
                ← Back
              </button>
              {selectedDef.fields.map((f) => (
                <FormField
                  key={f.name}
                  field={f}
                  value={formValues[f.name] ?? ""}
                  onChange={(v) =>
                    setFormValues((prev) => ({ ...prev, [f.name]: v }))
                  }
                />
              ))}
              <button
                type="button"
                className="ts-compose"
                onClick={handleCompose}
                disabled={!requiredFilled}
              >
                Compose
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function FormField({
  field,
  value,
  onChange,
}: {
  field: TemplateField;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `ts-field-${field.name}`;
  return (
    <div className="ts-field">
      <label className="ts-field-label" htmlFor={id}>
        {field.label}
        {field.required && <span className="ts-field-required"> *</span>}
      </label>
      {field.type === "text" && (
        <input
          id={id}
          type="text"
          className="ts-field-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          autoComplete="off"
          spellCheck={false}
        />
      )}
      {field.type === "textarea" && (
        <textarea
          id={id}
          className="ts-field-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          spellCheck={false}
        />
      )}
      {field.type === "radio" && field.options && (
        <div className="ts-field-radio" role="radiogroup" aria-label={field.label}>
          {field.options.map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={value === opt}
              className={
                "ts-radio-pill" + (value === opt ? " is-active" : "")
              }
              onClick={() => onChange(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
