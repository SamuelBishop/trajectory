/**
 * One turn of the conversation.
 *
 * Implements: [SC-NO-PLACEHOLDERS]
 *
 * The action row under an answer carries only what this application can
 * actually do. Rating and bookmarking are not among them: there is nowhere to
 * store a rating, and a control that silently does nothing is worse than no
 * control, because it teaches the user that the interface lies.
 */

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ChatMessage } from "../../../shared/types";
import { Icon } from "../ui/Icon";

function Actions({
  message,
  selected,
  onSelect,
}: {
  readonly message: ChatMessage;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard
      .writeText(message.content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => undefined);
  };

  return (
    <div className="message-actions">
      <button type="button" onClick={copy}>
        <Icon name={copied ? "check" : "copy"} size={15} />
        {copied ? "Copied" : "Copy"}
      </button>
      {message.grounding && (
        <button
          type="button"
          className={selected ? "active" : undefined}
          onClick={onSelect}
        >
          <Icon name="target" size={15} />
          Evidence
        </button>
      )}
    </div>
  );
}

export function Message({
  message,
  youMark,
  selected,
  onSelect,
}: {
  readonly message: ChatMessage;
  /** The user's initial, or "You" when no display name is stored. */
  readonly youMark: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element {
  const assistant = message.role === "assistant";
  return (
    <article
      className={`message message-${message.role}${
        assistant && selected ? " selected" : ""
      }`}
    >
      <div className="message-avatar">{assistant ? "T" : youMark}</div>
      <div className="message-body">
        <div className="message-label">{assistant ? "Trajectory" : "You"}</div>
        <div className="message-content">
          {assistant ? (
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Main-process navigation policy denies new windows and
                // renderer navigation. Keep links visibly useful without
                // pretending they can navigate this privileged window.
                a: ({ children, href }) => (
                  <a href={href} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {message.content}
            </Markdown>
          ) : (
            message.content
          )}
        </div>
        {assistant && message.content.length > 0 && (
          <Actions
            message={message}
            selected={selected}
            onSelect={onSelect}
          />
        )}
      </div>
    </article>
  );
}
