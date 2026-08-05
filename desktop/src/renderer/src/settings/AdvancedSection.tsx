/**
 * The credentials that authorise the model, and the statement about what this
 * app does with everything it holds.
 *
 * Implements: [HC-SECRETS-ENV-ONLY]
 *
 * Provider credentials stay out of the integration pages on purpose: they
 * authorise who answers, not what is read. Keeping them here also keeps the
 * integrations list free of anything a user has to understand before they can
 * connect their first source.
 */

import { useEffect, useState } from "react";

import type { SecretStatus } from "../../../shared/types";
import { Card } from "../ui/Card";
import { CredentialField, SignInSection } from "./CredentialField";

export function AdvancedSection(): React.JSX.Element {
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null);

  useEffect(() => {
    void window.trajectory
      .getSecretStatus()
      .then(setSecretStatus)
      .catch(() => undefined);
  }, []);

  const encryptionAvailable = secretStatus?.encryptionAvailable !== false;

  return (
    <>
      <Card>
        <SignInSection />
      </Card>

      <Card>
        <CredentialField
          title="GitHub Copilot credential"
          stored={secretStatus?.hasGithubToken === true}
          encryptionAvailable={encryptionAvailable}
          placeholder="ghp_…"
          storedNote="A token is stored and encrypted on this device. It is never displayed again."
          emptyNote="No token stored. Copilot will use the login from the Copilot CLI if there is one. An app launched from Finder inherits no shell environment, so a token is required on a machine that has never signed in."
          unavailableNote={
            <>
              This device cannot encrypt local storage, so Trajectory will not
              save a token here. Sign in with the Copilot CLI, or set{" "}
              <code>COPILOT_GITHUB_TOKEN</code> in the environment instead.
            </>
          }
          onStore={(value) => window.trajectory.setGithubToken(value)}
          onClear={() => window.trajectory.clearGithubToken()}
          onChanged={setSecretStatus}
        />
      </Card>

      <Card>
        <CredentialField
          title="OpenAI credential"
          stored={secretStatus?.hasOpenAiKey === true}
          encryptionAvailable={encryptionAvailable}
          placeholder="sk-…"
          storedNote="A key is stored and encrypted on this device. It is never displayed again."
          emptyNote="No key stored. The OpenAI provider will use OPENAI_API_KEY from the environment if it is set."
          unavailableNote={
            <>
              This device cannot encrypt local storage, so Trajectory will not
              save a key here. Set <code>OPENAI_API_KEY</code> in the environment
              instead.
            </>
          }
          onStore={(value) => window.trajectory.setOpenAiKey(value)}
          onClear={() => window.trajectory.clearOpenAiKey()}
          onChanged={setSecretStatus}
        />
      </Card>

      <Card>
        <h3 className="card-title">Privacy</h3>
        <p className="muted">
          Your goals, values, conversations, and everything the integrations
          collect are stored on this device and encrypted at rest. Trajectory
          never sends them anywhere except to the model provider you chose above,
          to answer the question you asked.
        </p>
        <p className="muted">
          {encryptionAvailable
            ? "Encryption is available on this device."
            : "This device cannot encrypt local storage. Rather than fall back to plaintext, Trajectory declines to store credentials or activity here at all."}
        </p>
      </Card>
    </>
  );
}
