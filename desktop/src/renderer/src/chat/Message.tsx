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

import { Children, isValidElement, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Citation } from "../../../shared/types";
import type { ChatMessage } from "../../../shared/types";
import { Icon } from "../ui/Icon";
import { CitationGroup } from "./Citation";
import { splitCitations, unreferencedCitations } from "./derive";

/**
 * Element types whose text is quoted rather than written.
 *
 * A bracketed id inside a code span is being shown, not cited, and turning it
 * into a control would misrepresent what the mentor wrote. Links are excluded
 * because a chip nested in an anchor is a control inside a control.
 */
const VERBATIM = new Set(["code", "pre", "a"]);

/**
 * The rendered markdown, with resolved citation groups swapped for marks.
 *
 * Done on the rendered children rather than with a remark plugin so the
 * substitution cannot change how anything else parses: markdown is turned into
 * elements first, and only the text that survived that is examined. The one
 * risky decision — what counts as a citation — lives in `splitCitations`, which
 * is pure and tested.
 */
function withCitations(
  children: ReactNode,
  citations: readonly Citation[],
): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      const segments = splitCitations(child, citations);
      if (segments.length === 1 && segments[0]?.kind === "text") return child;
      return segments.map((segment, index) =>
        segment.kind === "text" ? (
          segment.text
        ) : (
          <CitationGroup
            // Segment order is the only identity a run of prose has, and it is
            // stable for a given answer because the answer does not change.
            key={`citation-${String(index)}`}
            citations={segment.citations}
          />
        ),
      );
    }
    if (isValidElement(child)) {
      const props = child.props as { children?: ReactNode };
      if (typeof child.type === "string" && VERBATIM.has(child.type)) {
        return child;
      }
      if (props.children === undefined) return child;
      return {
        ...child,
        props: { ...props, children: withCitations(props.children, citations) },
      };
    }
    return child;
  });
}

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
  const citations = message.grounding?.citations ?? [];
  // The mentor cites in `activity_ids`, not in the sentence, so most answers
  // reference none of their records inline. Those get their marks here instead
  // of not getting them at all.
  const trailing = assistant
    ? unreferencedCitations(message.content, citations)
    : [];
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
                // Citations reach the reader inside ordinary prose, so the
                // blocks that carry prose are where they are swapped in.
                p: ({ children }) => <p>{withCitations(children, citations)}</p>,
                li: ({ children }) => (
                  <li>{withCitations(children, citations)}</li>
                ),
                td: ({ children }) => (
                  <td>{withCitations(children, citations)}</td>
                ),
              }}
            >
              {message.content}
            </Markdown>
          ) : (
            message.content
          )}
        </div>
        {trailing.length > 0 && (
          <div className="citation-row">
            <span className="citation-row-label">Based on</span>
            <CitationGroup citations={trailing} />
          </div>
        )}
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
