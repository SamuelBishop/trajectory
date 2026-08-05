/**
 * The conversation list: grouped by recency, dated, and pruned.
 *
 * A flat list of identical rows makes the user read every title to find last
 * Tuesday's thread. Grouping plus a date on each row means the answer is
 * usually visible without reading anything, and "Show more" keeps the older
 * ones one click away rather than one scroll away.
 */

import { useState } from "react";

import type { ConversationSummary } from "../../../shared/types";
import { Icon } from "../ui/Icon";
import { conversationStamp, groupConversations } from "./derive";

/** Enough rows to cover a normal week without turning the pane into a list. */
const EARLIER_PREVIEW = 5;

function Row({
  conversation,
  active,
  now,
  onOpen,
}: {
  readonly conversation: ConversationSummary;
  readonly active: boolean;
  readonly now: Date;
  readonly onOpen: () => void;
}): React.JSX.Element {
  const stamp = conversationStamp(conversation.updatedAt, now);
  return (
    <button
      type="button"
      className={active ? "conversation-row active" : "conversation-row"}
      onClick={onOpen}
    >
      <span className="conversation-title">{conversation.title}</span>
      {stamp !== null && <span className="conversation-stamp">{stamp}</span>}
    </button>
  );
}

export function ConversationList({
  summaries,
  activeId,
  now,
  onOpen,
  onCreate,
}: {
  readonly summaries: readonly ConversationSummary[];
  readonly activeId: string | undefined;
  readonly now: Date;
  readonly onOpen: (id: string) => void;
  readonly onCreate: () => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const { recent, earlier } = groupConversations(summaries, now);
  const shown = expanded ? earlier : earlier.slice(0, EARLIER_PREVIEW);

  return (
    <aside className="sidebar">
      <button type="button" className="new-chat" onClick={onCreate}>
        <Icon name="plus" size={15} />
        <span>New conversation</span>
        <kbd>⌘N</kbd>
      </button>

      <div className="conversation-list">
        {recent.length > 0 && (
          <>
            <h2 className="conversation-group">Recent</h2>
            {recent.map((conversation) => (
              <Row
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === activeId}
                now={now}
                onOpen={() => onOpen(conversation.id)}
              />
            ))}
          </>
        )}

        {earlier.length > 0 && (
          <>
            <h2 className="conversation-group">Earlier</h2>
            {shown.map((conversation) => (
              <Row
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === activeId}
                now={now}
                onOpen={() => onOpen(conversation.id)}
              />
            ))}
            {earlier.length > EARLIER_PREVIEW && (
              <button
                type="button"
                className={expanded ? "show-more expanded" : "show-more"}
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? "Show less" : "Show more"}
                <Icon name="chevron-down" size={14} />
              </button>
            )}
          </>
        )}
      </div>

      <div className="sidebar-footer">
        <span className="lock">●</span>
        History encrypted on this device
      </div>
    </aside>
  );
}
