/**
 * Context: everything an answer is allowed to be built from.
 *
 * Implements: [HC-RENDERER-IS-UNTRUSTED], [HC-MENTOR-IDENTITY-INTEGRITY]
 *
 * The user's five files and the mentor's four live on one screen because they
 * answer the same question — *why did it say that* — and the fix for a bad
 * answer is in one of the nine. Splitting them across two destinations, as this
 * app used to, meant the briefing could cite a goal and a principle while the
 * two lived in different parts of the application.
 *
 * The route carries the selection so the briefing's grounding links can open a
 * specific file directly. `mentor:` prefixes the mentor's four; anything else
 * is one of the user's.
 */

import { useEffect, useState } from "react";

import type {
  MentorConfigFile,
  MentorSummary,
  UserConfigFile,
} from "../../../shared/types";
import { toErrorMessage } from "../errors";
import { routeTo, type Route } from "../route";
import { Icon } from "../ui/Icon";
import { MENTOR_FILES, MentorFileEditor, mentorIdFromName } from "./MentorFileEditor";
import { USER_SECTIONS, UserFileEditor } from "./UserFileEditor";

const MENTOR_PREFIX = "mentor:";

export const CONTEXT_GOALS = "goals";
export const CONTEXT_PRINCIPLES = `${MENTOR_PREFIX}principles`;

interface Selection {
  readonly kind: "user" | "mentor";
  readonly file: string;
  readonly label: string;
  readonly blurb: string;
}

function selectionFor(sub: string | null): Selection {
  if (sub !== null && sub.startsWith(MENTOR_PREFIX)) {
    const file = sub.slice(MENTOR_PREFIX.length);
    const entry =
      MENTOR_FILES.find((item) => item.file === file) ?? MENTOR_FILES[0]!;
    return {
      kind: "mentor",
      file: entry.file,
      label: entry.label,
      blurb: entry.blurb,
    };
  }
  const entry =
    USER_SECTIONS.find((item) => item.file === sub) ?? USER_SECTIONS[0]!;
  return {
    kind: "user",
    file: entry.file,
    label: entry.label,
    blurb: entry.blurb,
  };
}

export function ContextView({
  route,
  mentors,
  activeMentorId,
  onNavigate,
  onMentorsChanged,
  onActivate,
}: {
  readonly route: Route;
  readonly mentors: readonly MentorSummary[];
  readonly activeMentorId: string;
  readonly onNavigate: (next: Route) => void;
  readonly onMentorsChanged: (mentors: MentorSummary[]) => void;
  readonly onActivate: (id: string) => void;
}): React.JSX.Element {
  const [selectedMentor, setSelectedMentor] = useState(activeMentorId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newMentorName, setNewMentorName] = useState("");

  useEffect(() => {
    // A mentor deleted elsewhere must not leave this pane editing a directory
    // that no longer exists.
    if (
      mentors.length > 0 &&
      !mentors.some((mentor) => mentor.id === selectedMentor)
    ) {
      setSelectedMentor(mentors[0]!.id);
    }
  }, [mentors, selectedMentor]);

  const selection = selectionFor(route.sub);
  const current = mentors.find((mentor) => mentor.id === selectedMentor);

  const run = async (
    action: () => Promise<MentorSummary[]>,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      onMentorsChanged(await action());
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
        window.trajectory.duplicateMentor(selectedMentor, id, name),
      ))
    ) {
      return;
    }
    setSelectedMentor(id);
    setNewMentorName("");
    setCreating(false);
  };

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm(`Delete the mentor "${id}"? This cannot be undone.`)) {
      return;
    }
    await run(() => window.trajectory.deleteMentor(id));
    if (selectedMentor === id) {
      setSelectedMentor(activeMentorId);
    }
  };

  const item = (
    key: string,
    label: string,
    active: boolean,
  ): React.JSX.Element => (
    <button
      key={key}
      type="button"
      className={`context-item ${active ? "active" : ""}`}
      aria-current={active ? "true" : undefined}
      onClick={() => onNavigate(routeTo("context", key))}
    >
      {label}
    </button>
  );

  return (
    <>
      <aside className="sidebar context-sidebar">
        <div className="sidebar-heading">Context</div>

        <div className="context-group">
          <p className="context-group-label">You</p>
          {USER_SECTIONS.map((entry) =>
            item(
              entry.file,
              entry.label,
              selection.kind === "user" && selection.file === entry.file,
            ),
          )}
        </div>

        <div className="context-group">
          <p className="context-group-label">Mentor</p>
          <label className="context-mentor-picker">
            <span className="field-hint">Editing</span>
            <select
              className="select-input"
              value={selectedMentor}
              disabled={busy || mentors.length === 0}
              onChange={(event) => setSelectedMentor(event.target.value)}
            >
              {mentors.map((mentor) => (
                <option key={mentor.id} value={mentor.id}>
                  {mentor.name}
                  {mentor.id === activeMentorId ? " (active)" : ""}
                  {mentor.loadable ? "" : " — broken"}
                </option>
              ))}
            </select>
          </label>
          {MENTOR_FILES.map((entry) =>
            item(
              `${MENTOR_PREFIX}${entry.file}`,
              entry.label,
              selection.kind === "mentor" && selection.file === entry.file,
            ),
          )}
        </div>

        <div className="sidebar-footer">
          <Icon name="lock" size={14} />
          Stored only on this device
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <h1>{selection.label}</h1>
            <span>
              {selection.kind === "mentor" && current?.loadable === false
                ? (current.problem ?? "This profile does not load.")
                : selection.blurb}
            </span>
          </div>
          {selection.kind === "mentor" && current && (
            <div className="header-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setCreating((open) => !open);
                  setError(null);
                }}
              >
                {creating ? "Cancel" : "Duplicate"}
              </button>
              <button
                type="button"
                disabled={busy || mentors.length < 2}
                onClick={() => void remove(current.id)}
              >
                Delete
              </button>
              {current.id !== activeMentorId && current.loadable && (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => onActivate(current.id)}
                >
                  Make active
                </button>
              )}
            </div>
          )}
        </header>

        {error && <div className="error-banner">{error}</div>}

        <section className="view-body">
          {creating && selection.kind === "mentor" && current && (
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

          {selection.kind === "user" ? (
            <UserFileEditor
              key={selection.file}
              file={selection.file as UserConfigFile}
            />
          ) : current ? (
            <MentorFileEditor
              key={`${current.id}:${selection.file}`}
              id={current.id}
              file={selection.file as MentorConfigFile}
            />
          ) : (
            <p className="empty-note">No mentor is installed.</p>
          )}
        </section>
      </main>
    </>
  );
}
