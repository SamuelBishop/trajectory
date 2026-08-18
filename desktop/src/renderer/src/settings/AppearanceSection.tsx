/**
 * Appearance settings: zoom presets.
 *
 * Selection previews immediately via the preload bridge; Save persists through
 * the normal settings path; Revert restores the selector and the zoom level.
 */

import { useEffect, useRef, useState } from "react";

import {
  isZoomPercent,
  ZOOM_PRESETS,
  type AppSettings,
  type ZoomPercent,
} from "../../../shared/types";
import { attempt, toErrorMessage } from "../errors";
import { Field, SaveBar } from "../FormKit";

export function AppearanceSection({
  settings,
  onSaved,
}: {
  readonly settings: AppSettings;
  readonly onSaved: (settings: AppSettings) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<ZoomPercent>(settings.zoomPercent);
  const savedZoom = useRef(settings.zoomPercent);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    savedZoom.current = settings.zoomPercent;
    setDraft(settings.zoomPercent);
  }, [settings.zoomPercent]);

  useEffect(() => {
    return () => {
      // An immediate preview is not a hidden save. Leaving Appearance without
      // saving restores the last persisted value so the UI cannot disagree
      // with the selector when the user returns.
      void window.trajectory
        .setZoomPercent(savedZoom.current)
        .catch((error: unknown) => {
          console.error(
            "Could not restore the saved zoom:",
            toErrorMessage(error),
          );
        });
    };
  }, []);

  const dirty = draft !== settings.zoomPercent;

  const preview = (percent: ZoomPercent): void => {
    setDraft(percent);
    setProblem(null);
    void attempt(() => window.trajectory.setZoomPercent(percent)).catch(
      (error: unknown) => {
        setProblem(toErrorMessage(error));
      },
    );
  };

  const save = (): void => {
    setSaving(true);
    setStatus(null);
    setProblem(null);
    void attempt(() =>
      window.trajectory.saveSettings({ ...settings, zoomPercent: draft }),
    )
      .then((saved) => {
        savedZoom.current = saved.zoomPercent;
        onSaved(saved);
        setStatus("Saved");
      })
      .catch((error: unknown) => {
        setProblem(toErrorMessage(error));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const revert = (): void => {
    setDraft(settings.zoomPercent);
    setStatus(null);
    setProblem(null);
    void attempt(() =>
      window.trajectory.setZoomPercent(settings.zoomPercent),
    ).catch((error: unknown) => {
      setProblem(toErrorMessage(error));
    });
  };

  return (
    <div className="settings-card">
      <div className="settings-card-body">
        <Field label="Zoom" hint="Scales the entire interface.">
          <select
            className="select-input"
            value={draft}
            disabled={saving}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (isZoomPercent(value)) {
                preview(value);
              }
            }}
          >
            {ZOOM_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}%
              </option>
            ))}
          </select>
        </Field>
      </div>

      <SaveBar
        dirty={dirty}
        saving={saving}
        status={status}
        problem={problem}
        onSave={save}
        onRevert={revert}
      />
    </div>
  );
}
