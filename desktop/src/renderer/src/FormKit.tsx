/**
 * Form primitives shared by the profile, mentor, and settings editors.
 *
 * Implements: [HC-RENDERER-IS-UNTRUSTED]
 *
 * Nothing here validates anything. The renderer's job is to collect input and
 * show what the main process said about it; the schema check that decides
 * whether a save happens runs behind IPC, where the renderer cannot skip it.
 */

import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <input
      className="text-input"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function TextArea({
  value,
  onChange,
  rows = 3,
  placeholder,
  disabled,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly rows?: number;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <textarea
      className="text-area"
      value={value}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <input
      className="text-input"
      type="number"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(event) => {
        const next = Number(event.target.value);
        // An unparseable entry is left to the caller's previous value rather
        // than becoming NaN, which would serialize as `null` and fail the schema.
        onChange(Number.isNaN(next) ? value : next);
      }}
    />
  );
}

export function Select<OptionT extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  readonly value: OptionT;
  readonly onChange: (value: OptionT) => void;
  readonly options: readonly { readonly value: OptionT; readonly label: string }[];
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <select
      className="select-input"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as OptionT)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/** A comma-separated editor for short string lists like domains or tags. */
export function TagInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  readonly value: readonly string[];
  readonly onChange: (value: string[]) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <input
      className="text-input"
      value={value.join(", ")}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) =>
        onChange(
          event.target.value
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
        )
      }
    />
  );
}

export function ListEditor<ItemT>({
  items,
  onChange,
  create,
  render,
  addLabel,
  emptyLabel,
  disabled,
}: {
  readonly items: readonly ItemT[];
  readonly onChange: (items: ItemT[]) => void;
  readonly create: () => ItemT;
  readonly render: (item: ItemT, update: (next: ItemT) => void) => ReactNode;
  readonly addLabel: string;
  readonly emptyLabel: string;
  readonly disabled?: boolean;
}): React.JSX.Element {
  const replace = (index: number, next: ItemT): void => {
    onChange(items.map((item, position) => (position === index ? next : item)));
  };

  return (
    <div className="list-editor">
      {items.length === 0 && <p className="empty-note">{emptyLabel}</p>}
      {items.map((item, index) => (
        // Index keys are correct here: entries have no stable identity until
        // saved, and reordering is not offered.
        <div className="list-row" key={index}>
          <div className="list-row-body">
            {render(item, (next) => {
              replace(index, next);
            })}
          </div>
          <button
            type="button"
            className="list-remove"
            disabled={disabled}
            aria-label="Remove entry"
            onClick={() =>
              onChange(items.filter((_item, position) => position !== index))
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="list-add"
        disabled={disabled}
        onClick={() => onChange([...items, create()])}
      >
        + {addLabel}
      </button>
    </div>
  );
}

export function SaveBar({
  dirty,
  saving,
  status,
  problem,
  onSave,
  onRevert,
}: {
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly status: string | null;
  readonly problem: string | null;
  readonly onSave: () => void;
  readonly onRevert: () => void;
}): React.JSX.Element {
  return (
    <div className="save-bar">
      {problem ? (
        <span className="save-problem">{problem}</span>
      ) : (
        <span className="save-status">{status ?? ""}</span>
      )}
      <button type="button" onClick={onRevert} disabled={!dirty || saving}>
        Revert
      </button>
      <button
        type="button"
        className="primary"
        onClick={onSave}
        disabled={!dirty || saving}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
