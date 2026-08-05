/**
 * Stored credentials, and the sign-in that can stand in for one.
 *
 * Implements: [HC-SECRETS-ENV-ONLY], [HC-RENDERER-IS-UNTRUSTED]
 *
 * Every field here is write-only. This module can tell you that a credential is
 * stored and let you replace or remove it, but it never receives one, so a
 * compromised renderer dependency has nothing to read. That is also why these
 * controls sit next to the integration they authorise without ever travelling
 * inside `IntegrationsView` — only the boolean from `getSecretStatus()` does.
 */

import { useState } from "react";

import type {
  CopilotAuthStatus,
  LoginPrompt,
  SecretStatus,
} from "../../../shared/types";
import { attempt, toErrorMessage } from "../errors";
import { Field } from "../FormKit";

/**
 * One stored credential: a write-only field, a note about what is on disk, and
 * the two actions that change it.
 *
 * Each instance owns its own draft and busy state, so storing a token cannot
 * clear the other field's input or claim its status message. The value is only
 * ever sent outward — nothing here reads a credential back
 * ([HC-SECRETS-ENV-ONLY]).
 */
export function CredentialField({
  title,
  stored,
  encryptionAvailable,
  placeholder,
  storedNote,
  emptyNote,
  unavailableNote,
  onStore,
  onClear,
  onChanged,
}: {
  readonly title: string;
  readonly stored: boolean;
  readonly encryptionAvailable: boolean;
  readonly placeholder: string;
  readonly storedNote: string;
  readonly emptyNote: string;
  readonly unavailableNote: React.ReactNode;
  readonly onStore: (value: string) => Promise<SecretStatus>;
  readonly onClear: () => Promise<SecretStatus>;
  readonly onChanged: (status: SecretStatus) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = (action: () => Promise<SecretStatus>, done: string): void => {
    setBusy(true);
    setNote(null);
    // `attempt` because a bridge method the preload does not have throws
    // synchronously, and the whole point of this screen is that a credential
    // either stored or told you why not.
    void attempt(action)
      .then((next) => {
        onChanged(next);
        setDraft("");
        setNote(done);
      })
      .catch((error: unknown) => {
        setNote(toErrorMessage(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <h3 className="subsection-title">{title}</h3>
      {!encryptionAvailable ? (
        <p className="empty-note">{unavailableNote}</p>
      ) : (
        <>
          <p className="empty-note">{stored ? storedNote : emptyNote}</p>
          <Field
            label={stored ? "Replace" : "Value"}
            hint="Stored encrypted on this device and never shown again."
          >
            <input
              className="text-input"
              type="password"
              value={draft}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <div className="save-bar">
            <span className="save-status">{note ?? ""}</span>
            {stored && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(onClear, "Removed.")}
              >
                Remove
              </button>
            )}
            <button
              type="button"
              className="primary"
              disabled={busy || draft.trim().length === 0}
              onClick={() => run(() => onStore(draft), "Stored.")}
            >
              {busy ? "Saving…" : "Store"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * The Google service account key, pasted whole.
 *
 * Not a `CredentialSection`, for two reasons. The value is a JSON file rather
 * than a token, so it needs room and must be readable while pasting — a masked
 * one-line box gives no way to tell a truncated paste from a complete one. And
 * only part of it is secret: the private key goes to the encrypted store, the
 * account's address goes to integrations config, because that address is what
 * the user has to type into Google's share dialog afterwards.
 *
 * Taking the whole file rather than asking for the PEM is deliberate. That key
 * is a multi-line value with escaped newlines inside a JSON string; extracting
 * it by hand is a step people get wrong, and `JSON.parse` does it correctly.
 */
export function ServiceAccountField({
  stored,
  encryptionAvailable,
  onChanged,
}: {
  readonly stored: boolean;
  readonly encryptionAvailable: boolean;
  readonly onChanged: (status: SecretStatus) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const settle = (
    action: () => Promise<{ ok: boolean; problem: string | null }>,
    done: string,
  ): void => {
    setBusy(true);
    setNote(null);
    // `attempt` because a bridge method an older preload does not have throws
    // synchronously, which would otherwise leave the button disabled forever.
    void attempt(action)
      .then(async (outcome) => {
        setNote(outcome.ok ? done : outcome.problem);
        if (outcome.ok) {
          setDraft("");
        }
        onChanged(await window.trajectory.getSecretStatus());
      })
      .catch((error: unknown) => {
        setNote(toErrorMessage(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <h3 className="subsection-title">Google service account</h3>
      {!encryptionAvailable ? (
        <p className="empty-note">
          This device cannot encrypt local storage, so Trajectory will not save
          a key here. The spreadsheet integration stays unavailable until
          encryption is.
        </p>
      ) : (
        <>
          <p className="empty-note">
            {stored
              ? "A key is stored and encrypted on this device. It is never displayed again."
              : "Only needed to read a Google Sheet. In the Google Cloud console: create a project, enable the Google Sheets API, create a service account, then create a JSON key and download it. Paste the whole file below."}
          </p>
          <Field
            label={stored ? "Replace" : "Key file"}
            hint="The private key is stored encrypted. The account's address is kept in plain sight, because you need it to share the sheet."
          >
            <textarea
              className="text-input"
              rows={5}
              value={draft}
              placeholder={'{ "type": "service_account", … }'}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <div className="save-bar">
            <span className="save-status">{note ?? ""}</span>
            {stored && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setNote(null);
                  void attempt(() =>
                    window.trajectory.clearGoogleServiceAccount(),
                  )
                    .then((next) => {
                      onChanged(next);
                      setNote("Removed.");
                    })
                    .catch((error: unknown) => {
                      setNote(toErrorMessage(error));
                    })
                    .finally(() => {
                      setBusy(false);
                    });
                }}
              >
                Remove
              </button>
            )}
            <button
              type="button"
              className="primary"
              disabled={busy || draft.trim().length === 0}
              onClick={() =>
                settle(
                  () => window.trajectory.saveGoogleServiceAccount(draft),
                  "Stored. Share the sheet with the address shown in the Activity pane.",
                )
              }
            >
              {busy ? "Saving…" : "Store"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Interactive GitHub sign-in.
 *
 * The device flow is the honest default for a desktop app: the browser handles
 * the credential, and the runtime stores it in the system keychain. This view
 * only ever sees a short-lived user code.
 *
 * Status comes from the runtime rather than from anything this app remembers,
 * so it stays accurate when the credential is changed or revoked elsewhere. It
 * costs a runtime start, so it is checked on demand and after signing in — not
 * on every render.
 */
export function SignInSection(): React.JSX.Element {
  const [status, setStatus] = useState<CopilotAuthStatus | null>(null);
  const [prompt, setPrompt] = useState<LoginPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = (): void => {
    setBusy(true);
    void attempt(() => window.trajectory.getAuthStatus())
      .then(setStatus)
      .catch(() => setStatus({ isAuthenticated: false }))
      .finally(() => setBusy(false));
  };

  const signIn = (): void => {
    setBusy(true);
    setNote(null);
    void attempt(() => window.trajectory.startSignIn())
      .then((next) => {
        setPrompt(next);
        return window.trajectory.waitForSignIn();
      })
      .then((result) => {
        setPrompt(null);
        setNote(result.ok ? "Signed in." : (result.problem ?? "Sign-in failed."));
        if (result.ok) refresh();
      })
      .catch((error: unknown) => {
        setPrompt(null);
        setNote(toErrorMessage(error));
      })
      .finally(() => setBusy(false));
  };

  const cancel = (): void => {
    void window.trajectory.cancelSignIn().catch(() => undefined);
    setPrompt(null);
  };

  return (
    <>
      <h3 className="subsection-title">GitHub sign-in</h3>
      {prompt ? (
        <>
          <p className="empty-note">
            Your browser should have opened. Enter this code to finish signing
            in.
          </p>
          <p className="device-code">{prompt.userCode}</p>
          <p className="empty-note">
            If the browser did not open, go to{" "}
            <code>{prompt.verificationUri}</code>.
          </p>
          <div className="save-bar">
            <span className="save-status">Waiting for authorization…</span>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="empty-note">
            {status === null
              ? "Sign in with GitHub to use Copilot, or check whether this device is already signed in."
              : status.isAuthenticated
                ? `Signed in${status.login ? ` as ${status.login}` : ""}. Copilot is ready to use.`
                : "Not signed in. Copilot needs either a sign-in or a token below."}
          </p>
          <div className="save-bar">
            <span className="save-status">{note ?? ""}</span>
            <button type="button" disabled={busy} onClick={refresh}>
              {busy ? "Checking…" : "Check status"}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={signIn}
            >
              {status?.isAuthenticated ? "Sign in again" : "Sign in with GitHub"}
            </button>
          </div>
        </>
      )}
    </>
  );
}
