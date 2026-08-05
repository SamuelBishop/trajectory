/**
 * Editors for the four files that describe a mentor.
 *
 * Implements: [HC-MENTOR-IDENTITY-INTEGRITY], [HC-RENDERER-LEAST-PRIVILEGE]
 *
 * Attribution rules are enforced in the engine, not here. A profile marked
 * fictional must cite synthetic sources, and every principle must name a
 * source that exists; this file simply reports the refusal when a save breaks
 * one of those, because the alternative is a mentor that quotes a person who
 * never said it.
 */

import type { ConfigDocument, MentorConfigFile } from "../../../shared/types";
import { Field, SaveBar, TagInput, TextArea, TextInput } from "../FormKit";
import { useDocument } from "../useDocument";

interface Profile {
  id: string;
  name: string;
  fictional: boolean;
  description: string;
  domains: string[];
  disclaimer: string;
  body: string;
}

export const MENTOR_FILES: readonly {
  readonly file: MentorConfigFile;
  readonly label: string;
  readonly blurb: string;
}[] = [
  {
    file: "profile",
    label: "Profile",
    blurb: "Who this mentor is, and what they will and will not claim to be.",
  },
  {
    file: "principles",
    label: "Principles",
    blurb: "The beliefs an answer may be grounded in, each citing a source.",
  },
  {
    file: "sources",
    label: "Sources",
    blurb: "The evidence behind those principles.",
  },
  {
    file: "voice",
    label: "Voice",
    blurb: "How they write. Structure only — never new beliefs.",
  },
];

export function mentorIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

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

export function MentorFileEditor({
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
