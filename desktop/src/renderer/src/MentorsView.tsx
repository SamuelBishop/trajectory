/**
 * Mentor profiles: pick one, edit it, copy it, delete it.
 *
 * Implements: [HC-MENTOR-IDENTITY-INTEGRITY],
 * [HC-RENDERER-LEAST-PRIVILEGE]
 *
 * Attribution rules are enforced in the engine, not here. A profile marked
 * fictional must cite synthetic sources, and every principle must name a
 * source that exists; this view simply reports the refusal when a save breaks
 * one of those, because the alternative is a mentor that quotes a person who
 * never said it.
 */

import { useEffect, useState } from "react";

import type {
  ConfigDocument,
  MentorConfigFile,
  MentorSummary,
} from "../../shared/types";
import { toErrorMessage } from "./errors";
import { Field, SaveBar, TagInput, TextArea, TextInput } from "./FormKit";
import { useDocument } from "./useDocument";

function mentorIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

interface Profile {
  id: string;
  name: string;
  fictional: boolean;
  description: string;
  domains: string[];
  disclaimer: string;
  body: string;
}

const FILES: readonly { file: MentorConfigFile; label: string }[] = [
  { file: "profile", label: "Profile" },
  { file: "principles", label: "Principles" },
  { file: "sources", label: "Sources" },
  { file: "voice", label: "Voice" },
];

function voiceScaffold(mentorId: string): string {
  return `version: 2
mentor_id: ${mentorId}

purpose: >-
  Describe how this mentor should reason, write, and relate to the user without
  adding beliefs or evidence.
voice:
  tone: [calm, direct, respectful]
  reader_relationship: Treat the reader as intelligent and capable.
  prose:
    - Use plain, precise language.
    - Prefer short paragraphs and natural sentence-length variation.
  cadence:
    default_arc:
      - answer the visible question
      - explain the relevant mechanism
      - state the practical implication
    instruction: Use this arc only when every step improves the answer.
patterns:
  - id: answer_then_explain
    strength: very_high
    instruction: Answer the narrow question early, then explain the mechanism.
  - id: bound_the_claim
    strength: high
    instruction: Separate what is known from what remains contextual or uncertain.
  - id: practical_ending
    strength: high
    instruction: End with the decision, next action, or update condition when useful.
selection:
  brief:
    pattern_count: 1
    example_count: 0-1
  standard:
    pattern_count: 2
    example_count: 1
  deep:
    pattern_count: 2-3
    example_count: 1-2
  instruction: Select only the patterns relevant to the question.
chat:
  - Use less setup than polished long-form writing.
  - Do not mention the voice profile or selected examples.
avoid:
  - generic motivation
  - repeated rhetorical questions
  - reusing example wording as a catchphrase
examples:
  usage: These examples demonstrate cadence. Do not copy their wording.
  items:
    - id: direct_opening
      purpose: short_answer
      tags: [decision, uncertainty]
      pattern_ids: [answer_then_explain, bound_the_claim]
      text: The concern is real, but it does not settle the decision. Start with the constraint that would actually change the outcome.
    - id: bounded_ending
      purpose: practical_ending
      tags: [action, next_step]
      pattern_ids: [practical_ending]
      text: Take the smallest useful step, then update when the result changes what you know.
`;
}

function source(
  id: string,
  file: MentorConfigFile,
): {
  read: () => Promise<ConfigDocument>;
  writeModel: (model: unknown) => Promise<ConfigDocument>;
  writeText: (text: string) => Promise<ConfigDocument>;
} {
  return {
    read: () => window.trajectory.readMentorConfig(id, file),
    writeModel: (model: unknown) =>
      window.trajectory.writeMentorConfig(id, file, model),
    writeText: (text: string) =>
      window.trajectory.writeMentorConfigText(id, file, text),
  };
}

function ProfileForm({
  model,
  onChange,
  disabled,
}: {
  readonly model: Profile;
  readonly onChange: (model: Profile) => void;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <>
      <div className="field-row">
        <Field label="ID" hint="Changing this breaks its principles and sources.">
          <TextInput value={model.id} onChange={() => undefined} disabled />
        </Field>
        <Field label="Name">
          <TextInput
            value={model.name}
            onChange={(name) => onChange({ ...model, name })}
            disabled={disabled}
          />
        </Field>
      </div>
      <Field label="Description">
        <TextArea
          value={model.description}
          onChange={(description) => onChange({ ...model, description })}
          disabled={disabled}
        />
      </Field>
      <Field label="Domains" hint="Comma separated, lowercase.">
        <TagInput
          value={model.domains}
          onChange={(domains) => onChange({ ...model, domains })}
          disabled={disabled}
        />
      </Field>
      <Field
        label="Disclaimer"
        hint="Shown to make clear what this mentor is and is not."
      >
        <TextArea
          value={model.disclaimer}
          onChange={(disclaimer) => onChange({ ...model, disclaimer })}
          disabled={disabled}
        />
      </Field>
      <Field
        label="Fictional"
        hint={
          model.fictional
            ? "Fictional. Every source must be marked synthetic."
            : "Real. Sources must be genuine and approved."
        }
      >
        <TextInput
          value={model.fictional ? "yes" : "no"}
          onChange={() => undefined}
          disabled
        />
      </Field>
      <Field
        label="Mentor guidance"
        hint="Beliefs, boundaries, and domain guidance. Markdown."
      >
        <TextArea
          value={model.body}
          rows={14}
          onChange={(body) => onChange({ ...model, body })}
          disabled={disabled}
        />
      </Field>
    </>
  );
}

function MentorEditor({
  id,
  file,
}: {
  readonly id: string;
  readonly file: MentorConfigFile;
}): React.JSX.Element {
  const editor = useDocument<Record<string, unknown>>(
    source(id, file),
    [id, file],
    file === "profile" ? "form" : "yaml",
  );
  const { model, mode, saving } = editor;

  if (editor.loading) {
    return <div className="center-state">Loading…</div>;
  }

  // Provenance-linked lists are clearer in YAML than in a deeply nested form.
  const formAvailable = file === "profile" && model !== undefined;

  return (
    <div className="editor">
      <div className="editor-tabs">
        {formAvailable && (
          <button
            className={mode === "form" ? "active" : ""}
            onClick={() => editor.setMode("form")}
          >
            Form
          </button>
        )}
        <button
          className={mode === "yaml" || !formAvailable ? "active" : ""}
          onClick={() => editor.setMode("yaml")}
        >
          {file === "profile" ? "Markdown" : "YAML"}
        </button>
      </div>

      <div className="editor-body">
        {file === "voice" && editor.missing && !editor.dirty ? (
          <div className="center-state">
            <p>This mentor uses the default Trajectory voice.</p>
            <button
              className="primary"
              onClick={() => editor.setText(voiceScaffold(id))}
            >
              Create voice profile
            </button>
          </div>
        ) : mode === "form" && formAvailable ? (
          <ProfileForm
            model={model as unknown as Profile}
            onChange={(next) =>
              editor.setModel(next as unknown as Record<string, unknown>)
            }
            disabled={saving}
          />
        ) : (
          <textarea
            className="yaml-editor"
            value={editor.text}
            spellCheck={false}
            disabled={saving}
            onChange={(event) => editor.setText(event.target.value)}
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

export function MentorsView({
  activeMentorId,
  onActivate,
}: {
  readonly activeMentorId: string;
  readonly onActivate: (id: string) => void;
}): React.JSX.Element {
  const [mentors, setMentors] = useState<MentorSummary[]>([]);
  const [selected, setSelected] = useState(activeMentorId);
  const [file, setFile] = useState<MentorConfigFile>("profile");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newMentorName, setNewMentorName] = useState("");

  useEffect(() => {
    void window.trajectory
      .listMentors()
      .then(setMentors)
      .catch((listError: unknown) => {
        setError(toErrorMessage(listError));
      });
  }, []);

  const run = async (
    action: () => Promise<MentorSummary[]>,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      setMentors(await action());
      return true;
    } catch (actionError) {
      setError(toErrorMessage(actionError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (): Promise<void> => {
    const name = newMentorName.trim();
    const id = mentorIdFromName(name);
    if (!name || !/^[a-z][a-z0-9_]{1,63}$/.test(id)) {
      setError(
        "Enter a name that produces an ID of 2–64 lowercase letters, digits, or underscores.",
      );
      return;
    }
    if (
      !(await run(() =>
        window.trajectory.duplicateMentor(selected, id, name),
      ))
    ) {
      return;
    }
    setSelected(id);
    setNewMentorName("");
    setCreating(false);
  };

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm(`Delete the mentor "${id}"? This cannot be undone.`)) {
      return;
    }
    await run(() => window.trajectory.deleteMentor(id));
    if (selected === id) {
      setSelected(activeMentorId);
    }
  };

  const current = mentors.find((mentor) => mentor.id === selected);

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-heading">Mentors</div>
        <button
          className="new-chat"
          disabled={busy || !current}
          onClick={() => {
            setCreating((open) => !open);
            setError(null);
          }}
        >
          <span>{creating ? "×" : "+"}</span>
          {creating ? "Cancel" : "Duplicate selected"}
        </button>
        {creating && current && (
          <form
            className="mentor-create"
            onSubmit={(event) => {
              event.preventDefault();
              void duplicate();
            }}
          >
            <label htmlFor="mentor-name">Name for your mentor</label>
            <input
              id="mentor-name"
              className="text-input"
              value={newMentorName}
              maxLength={120}
              placeholder="For example, Samuel"
              autoFocus
              disabled={busy}
              onChange={(event) => setNewMentorName(event.target.value)}
            />
            {newMentorName.trim() && (
              <span className="mentor-id-preview">
                ID: {mentorIdFromName(newMentorName) || "—"}
              </span>
            )}
            <button
              type="submit"
              className="primary"
              disabled={busy || newMentorName.trim().length === 0}
            >
              {busy ? "Creating…" : `Create from ${current.name}`}
            </button>
          </form>
        )}
        <div className="conversation-list">
          {mentors.map((mentor) => (
            <div
              className={`conversation-item ${
                mentor.id === selected ? "active" : ""
              }`}
              key={mentor.id}
            >
              <button
                className="conversation-open"
                onClick={() => setSelected(mentor.id)}
              >
                <span className="conversation-title">
                  {mentor.name}
                  {mentor.id === activeMentorId && (
                    <em className="badge">active</em>
                  )}
                </span>
                {!mentor.loadable && <em className="badge warn">broken</em>}
              </button>
              <button
                className="delete-chat"
                disabled={busy}
                aria-label={`Delete ${mentor.name}`}
                onClick={() => void remove(mentor.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <h1>{current?.name ?? "Mentors"}</h1>
            <span>
              {current?.loadable === false
                ? (current.problem ?? "This profile does not load.")
                : (current?.description ?? "Choose a mentor to edit.")}
            </span>
          </div>
          {current && current.id !== activeMentorId && current.loadable && (
            <button
              className="primary"
              onClick={() => onActivate(current.id)}
              disabled={busy}
            >
              Make active
            </button>
          )}
        </header>

        {error && <div className="error-banner">{error}</div>}

        {current && (
          <section className="view-body">
            <div className="segmented">
              {FILES.map((entry) => (
                <button
                  key={entry.file}
                  className={entry.file === file ? "active" : ""}
                  onClick={() => setFile(entry.file)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <MentorEditor key={`${current.id}:${file}`} id={current.id} file={file} />
          </section>
        )}
      </main>
    </>
  );
}
