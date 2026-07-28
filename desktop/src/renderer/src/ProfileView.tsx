/**
 * Editors for the five files that describe the user.
 *
 * Implements: [HC-RENDERER-IS-UNTRUSTED]
 *
 * Every field here mirrors a schema in `engine/domain.ts`. The mirror is
 * deliberately shallow — the form decides what is easy to type, the schema
 * decides what is allowed, and the schema runs in the main process where this
 * code cannot reach it.
 */

import { useState } from "react";

import type { ConfigDocument, UserConfigFile } from "../../shared/types";
import {
  Field,
  ListEditor,
  NumberInput,
  SaveBar,
  Select,
  TagInput,
  TextArea,
  TextInput,
} from "./FormKit";
import { useDocument } from "./useDocument";

interface Goal {
  id: string;
  description: string;
  motivation: string;
  priority: number;
  domain: string;
  success_criteria: string[];
  status: "active" | "paused" | "completed" | "rejected";
  target_date: string | null;
  tags: string[];
}

const SECTIONS: readonly {
  readonly file: UserConfigFile;
  readonly label: string;
  readonly blurb: string;
}[] = [
  {
    file: "goals",
    label: "Goals",
    blurb: "What you are trying to reach, and how you will know you have.",
  },
  {
    file: "values",
    label: "Values",
    blurb: "What you will not trade away to get there.",
  },
  {
    file: "current_state",
    label: "Current state",
    blurb: "Where you actually are right now, not where you plan to be.",
  },
  {
    file: "constraints",
    label: "Constraints",
    blurb: "The limits any honest advice has to respect.",
  },
  {
    file: "communication",
    label: "Communication",
    blurb: "How you want to be spoken to when the answer is unwelcome.",
  },
];

function source(file: UserConfigFile): {
  read: () => Promise<ConfigDocument>;
  writeModel: (model: unknown) => Promise<ConfigDocument>;
  writeText: (text: string) => Promise<ConfigDocument>;
} {
  return {
    read: () => window.trajectory.readUserConfig(file),
    writeModel: (model: unknown) =>
      window.trajectory.writeUserConfig(file, model),
    writeText: (text: string) =>
      window.trajectory.writeUserConfigText(file, text),
  };
}

function StringList({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: readonly string[] | undefined;
  readonly onChange: (value: string[]) => void;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {hint && <span className="field-hint">{hint}</span>}
      <ListEditor
        items={value ?? []}
        onChange={onChange}
        create={() => ""}
        addLabel="Add"
        emptyLabel="Nothing here yet."
        disabled={disabled}
        render={(item, update) => (
          <TextArea value={item} onChange={update} rows={2} disabled={disabled} />
        )}
      />
    </div>
  );
}

function GoalsForm({
  model,
  onChange,
  disabled,
}: {
  readonly model: { goals: Goal[] };
  readonly onChange: (model: { goals: Goal[] }) => void;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <ListEditor
      items={model.goals}
      onChange={(goals) => onChange({ goals })}
      create={() => ({
        id: `goal_${String(model.goals.length + 1)}`,
        description: "",
        motivation: "",
        priority: 3,
        domain: "career",
        success_criteria: [],
        status: "active" as const,
        target_date: null,
        tags: [],
      })}
      addLabel="Add goal"
      emptyLabel="No goals yet. At least one is required."
      disabled={disabled}
      render={(goal, update) => (
        <div className="sub-form">
          <div className="field-row">
            <Field label="ID" hint="Lowercase, used for citation.">
              <TextInput
                value={goal.id}
                onChange={(id) => update({ ...goal, id })}
                disabled={disabled}
              />
            </Field>
            <Field label="Domain">
              <TextInput
                value={goal.domain}
                onChange={(domain) => update({ ...goal, domain })}
                disabled={disabled}
              />
            </Field>
            <Field label="Priority" hint="1 is highest.">
              <NumberInput
                value={goal.priority}
                min={1}
                max={5}
                step={1}
                onChange={(priority) => update({ ...goal, priority })}
                disabled={disabled}
              />
            </Field>
            <Field label="Status">
              <Select
                value={goal.status}
                onChange={(status) => update({ ...goal, status })}
                disabled={disabled}
                options={[
                  { value: "active", label: "Active" },
                  { value: "paused", label: "Paused" },
                  { value: "completed", label: "Completed" },
                  { value: "rejected", label: "Rejected" },
                ]}
              />
            </Field>
          </div>
          <Field label="Description">
            <TextArea
              value={goal.description}
              onChange={(description) => update({ ...goal, description })}
              disabled={disabled}
            />
          </Field>
          <Field label="Motivation" hint="Why this matters to you.">
            <TextArea
              value={goal.motivation}
              onChange={(motivation) => update({ ...goal, motivation })}
              disabled={disabled}
            />
          </Field>
          <StringList
            label="Success criteria"
            hint="How you will know this is done. At least one is required."
            value={goal.success_criteria}
            onChange={(success_criteria) => update({ ...goal, success_criteria })}
            disabled={disabled}
          />
          <div className="field-row">
            <Field label="Target date" hint="YYYY-MM-DD, or leave blank.">
              <TextInput
                value={goal.target_date ?? ""}
                placeholder="2026-12-31"
                onChange={(value) =>
                  update({
                    ...goal,
                    target_date: value.trim() === "" ? null : value.trim(),
                  })
                }
                disabled={disabled}
              />
            </Field>
            <Field label="Tags" hint="Comma separated.">
              <TagInput
                value={goal.tags}
                onChange={(tags) => update({ ...goal, tags })}
                disabled={disabled}
              />
            </Field>
          </div>
        </div>
      )}
    />
  );
}

/** Every remaining user file is either a list of strings or a short string. */
function GenericForm({
  model,
  onChange,
  listHints,
  multiline,
  disabled,
}: {
  readonly model: Record<string, unknown>;
  readonly onChange: (model: Record<string, unknown>) => void;
  readonly listHints?: Readonly<Record<string, string>>;
  readonly multiline?: boolean;
  readonly disabled?: boolean;
}): React.JSX.Element {
  const label = (key: string): string =>
    key.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());

  return (
    <>
      {Object.entries(model).map(([key, value]) => {
        if (Array.isArray(value)) {
          return (
            <StringList
              key={key}
              label={label(key)}
              {...(listHints?.[key] ? { hint: listHints[key] } : {})}
              value={value as string[]}
              onChange={(next) => onChange({ ...model, [key]: next })}
              disabled={disabled}
            />
          );
        }
        return (
          <Field key={key} label={label(key)}>
            {multiline ? (
              <TextArea
                value={String(value ?? "")}
                onChange={(next) => onChange({ ...model, [key]: next })}
                rows={2}
                disabled={disabled}
              />
            ) : (
              <TextInput
                value={String(value ?? "")}
                onChange={(next) => onChange({ ...model, [key]: next })}
                disabled={disabled}
              />
            )}
          </Field>
        );
      })}
    </>
  );
}

function SectionEditor({ file }: { readonly file: UserConfigFile }) {
  const editor = useDocument<Record<string, unknown>>(source(file), [file]);
  const { model, mode, saving } = editor;

  if (editor.loading) {
    return <div className="center-state">Loading…</div>;
  }

  return (
    <div className="editor">
      <div className="editor-tabs">
        <button
          className={mode === "form" ? "active" : ""}
          onClick={() => editor.setMode("form")}
          disabled={Boolean(editor.problem) && model === undefined}
        >
          Form
        </button>
        <button
          className={mode === "yaml" ? "active" : ""}
          onClick={() => editor.setMode("yaml")}
        >
          YAML
        </button>
      </div>

      <div className="editor-body">
        {mode === "yaml" ? (
          <textarea
            className="yaml-editor"
            value={editor.text}
            spellCheck={false}
            disabled={saving}
            onChange={(event) => editor.setText(event.target.value)}
          />
        ) : model === undefined ? (
          <p className="empty-note">
            This file cannot be shown as a form until it parses. Use the YAML
            tab to repair it.
          </p>
        ) : file === "goals" ? (
          <GoalsForm
            model={model as unknown as { goals: Goal[] }}
            onChange={(next) =>
              editor.setModel(next as unknown as Record<string, unknown>)
            }
            disabled={saving}
          />
        ) : (
          <GenericForm
            model={model}
            onChange={editor.setModel}
            multiline={file !== "communication"}
            disabled={saving}
          />
        )}
      </div>

      <SaveBar
        dirty={editor.dirty}
        saving={saving}
        status={editor.status}
        problem={editor.problem}
        onSave={editor.save}
        onRevert={editor.revert}
      />
    </div>
  );
}

export function ProfileView(): React.JSX.Element {
  const [active, setActive] = useState<UserConfigFile>("goals");
  const section = SECTIONS.find((item) => item.file === active) ?? SECTIONS[0]!;

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-heading">Your profile</div>
        <div className="conversation-list">
          {SECTIONS.map((item) => (
            <div
              className={`conversation-item ${
                item.file === active ? "active" : ""
              }`}
              key={item.file}
            >
              <button
                className="conversation-open"
                onClick={() => setActive(item.file)}
              >
                <span className="conversation-title">{item.label}</span>
              </button>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <span className="lock">●</span>
          Stored only on this device
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <h1>{section.label}</h1>
            <span>{section.blurb}</span>
          </div>
        </header>
        <section className="view-body">
          <SectionEditor key={active} file={active} />
        </section>
      </main>
    </>
  );
}
