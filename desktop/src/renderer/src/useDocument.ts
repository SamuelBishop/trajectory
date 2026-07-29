/**
 * Editing state for one configuration file.
 *
 * Implements: [HC-RENDERER-LEAST-PRIVILEGE]
 *
 * The form and the YAML tab edit the same file two ways, so this hook keeps
 * one rule: whichever surface you saved from, the document is re-read from
 * disk afterwards and both surfaces are reset from that result. The screen
 * therefore shows what was actually written, not what we hoped was written.
 */

import { useCallback, useEffect, useState } from "react";

import type { ConfigDocument } from "../../shared/types";
import { toErrorMessage } from "./errors";

export type EditorMode = "form" | "yaml";

export interface DocumentEditor<ModelT> {
  readonly loading: boolean;
  readonly mode: EditorMode;
  readonly setMode: (mode: EditorMode) => void;
  /** Undefined while loading, or when the file on disk fails to parse. */
  readonly model: ModelT | undefined;
  readonly setModel: (model: ModelT) => void;
  readonly text: string;
  readonly setText: (text: string) => void;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly status: string | null;
  readonly problem: string | null;
  readonly missing: boolean;
  readonly save: () => void;
  readonly revert: () => void;
  readonly reload: () => void;
}

export interface DocumentSource<ModelT> {
  readonly read: () => Promise<ConfigDocument>;
  readonly writeModel: (model: ModelT) => Promise<ConfigDocument>;
  readonly writeText: (text: string) => Promise<ConfigDocument>;
}

export function useDocument<ModelT>(
  source: DocumentSource<ModelT>,
  dependencies: readonly unknown[],
  initialMode: EditorMode = "form",
): DocumentEditor<ModelT> {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [model, setModelState] = useState<ModelT | undefined>(undefined);
  const [text, setTextState] = useState("");
  const [saved, setSaved] = useState<ConfigDocument | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const apply = useCallback((document: ConfigDocument): void => {
    setSaved(document);
    setTextState(document.text);
    setModelState(document.data as ModelT | undefined);
    setDirty(false);
    // A file that does not parse cannot be shown as a form. Switching to the
    // YAML tab is the only way the user can repair it.
    if (document.problem) {
      setProblem(document.problem);
      setMode("yaml");
    } else {
      setProblem(null);
    }
  }, []);

  const load = useCallback((): void => {
    setLoading(true);
    void source
      .read()
      .then(apply)
      .catch((error: unknown) => {
        setProblem(toErrorMessage(error));
      })
      .finally(() => {
        setLoading(false);
      });
    // The caller owns the dependency list because `source` is rebuilt on every
    // render; including it here would reload forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(load, [load]);

  const save = useCallback((): void => {
    setSaving(true);
    setStatus(null);
    setProblem(null);
    const write =
      mode === "yaml"
        ? source.writeText(text)
        : model === undefined
          ? Promise.reject(new Error("There is nothing to save."))
          : source.writeModel(model);

    void write
      .then((document) => {
        apply(document);
        setStatus("Saved");
      })
      .catch((error: unknown) => {
        setProblem(toErrorMessage(error));
      })
      .finally(() => {
        setSaving(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, text, model, apply, ...dependencies]);

  const revert = useCallback((): void => {
    if (saved) {
      apply(saved);
      setStatus(null);
    }
  }, [saved, apply]);

  return {
    loading,
    mode,
    setMode: (next) => {
      if (next === mode) {
        return;
      }
      // Switching surfaces with unsaved edits would show the other surface's
      // stale copy and silently discard them on the next save. Serializing the
      // form to YAML here would mean a second serializer in the renderer that
      // could drift from the writer's; making the user save or revert first is
      // both safer and honest about what is happening.
      if (dirty) {
        setStatus("Save or revert before switching editors.");
        return;
      }
      setStatus(null);
      setMode(next);
    },
    model,
    setModel: (next) => {
      setModelState(next);
      setDirty(true);
      setStatus(null);
    },
    text,
    setText: (next) => {
      setTextState(next);
      setDirty(true);
      setStatus(null);
    },
    dirty,
    saving,
    status,
    problem,
    missing: saved?.missing === true,
    save,
    revert,
    reload: load,
  };
}
