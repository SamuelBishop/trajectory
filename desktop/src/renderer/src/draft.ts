/**
 * Form state that survives a view refresh.
 *
 * Every settings editor here shows a draft of a value the main process owns.
 * The obvious implementation — `useEffect(() => setDraft(saved), [saved])` —
 * is wrong, because `saved` arrives over IPC and is a fresh object on every
 * update. Refreshing an integration, saving an unrelated card, or pausing sync
 * all hand back an equal-but-new object, and the effect then overwrites
 * whatever the user had typed. Silently: no warning, and the control snaps
 * back as though they had never touched it.
 *
 * So edits are tagged with the saved value they were made against. An update
 * that changes nothing keeps the edit; one that genuinely changes the saved
 * value wins, because at that point the form is showing something stale.
 */

import { useState } from "react";

export interface EditedDraft<ValueT> {
  readonly key: string;
  readonly value: ValueT;
}

/**
 * A value identity that survives serialization across the IPC boundary.
 *
 * Key order is sorted because it is an artifact of how the object was built,
 * not something the user changed. Treating a reordering as a change would drop
 * an edit for no reason the user could ever see.
 */
export function savedKey(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }
    return Object.fromEntries(
      Object.entries(entry as Record<string, unknown>).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }) ?? "";
}

export function resolveDraft<ValueT>(
  saved: ValueT,
  edited: EditedDraft<ValueT> | null,
): ValueT {
  if (edited === null) {
    return saved;
  }
  return edited.key === savedKey(saved) ? edited.value : saved;
}

export function useSavedDraft<ValueT>(saved: ValueT): {
  draft: ValueT;
  setDraft: (next: ValueT) => void;
  dirty: boolean;
} {
  const [edited, setEdited] = useState<EditedDraft<ValueT> | null>(null);
  const draft = resolveDraft(saved, edited);
  return {
    draft,
    setDraft: (next: ValueT) => {
      setEdited({ key: savedKey(saved), value: next });
    },
    dirty: savedKey(draft) !== savedKey(saved),
  };
}
