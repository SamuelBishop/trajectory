import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  ChatMessage,
  Conversation,
  ConversationSummary,
  ProviderName,
} from "../../shared/types";
import { toErrorMessage } from "./errors";

const SUGGESTIONS = [
  "What should I focus on this week?",
  "Should I spend another two hours polishing this low-risk pull request?",
  "Where am I drifting from my stated priorities?",
];

function Message({ message }: { message: ChatMessage }): React.JSX.Element {
  return (
    <article className={`message message-${message.role}`}>
      <div className="message-avatar">
        {message.role === "assistant" ? "T" : "You"}
      </div>
      <div className="message-body">
        <div className="message-label">
          {message.role === "assistant" ? "Trajectory" : "You"}
        </div>
        <div className="message-content">
          {message.role === "assistant" ? (
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
        {message.grounding && (
          <details className="grounding">
            <summary>
              Grounding · {Math.round(message.grounding.confidence * 100)}%
            </summary>
            <div className="grounding-row">
              {[...message.grounding.goalIds, ...message.grounding.principleIds].map(
                (id) => (
                  <span key={id}>{id}</span>
                ),
              )}
            </div>
            {message.grounding.uncertainties.map((uncertainty) => (
              <p key={uncertainty}>{uncertainty}</p>
            ))}
          </details>
        )}
      </div>
    </article>
  );
}

export interface ChatViewProps {
  readonly provider: ProviderName;
  readonly onChangeProvider: (provider: ProviderName) => void;
  readonly mentorName: string;
  readonly mentorDisclaimer: string;
}

export function ChatView({
  provider,
  onChangeProvider,
  mentorName,
  mentorDisclaimer,
}: ChatViewProps): React.JSX.Element {
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const activeRequestRef = useRef<string | null>(null);
  const initializationRef = useRef<Promise<{
    conversation: Conversation;
    summaries: ConversationSummary[];
  }> | null>(null);

  const activeId = active?.id;
  const canSend = draft.trim().length > 0 && !sending && Boolean(activeId);

  const refreshSummaries = async (): Promise<ConversationSummary[]> => {
    const items = await window.trajectory.listConversations();
    setSummaries(items);
    return items;
  };

  const openConversation = async (id: string): Promise<void> => {
    setError(null);
    const conversation = await window.trajectory.getConversation(id);
    setActive(conversation);
  };

  const newConversation = async (): Promise<void> => {
    setError(null);
    const conversation = await window.trajectory.createConversation();
    setActive(conversation);
    await refreshSummaries();
  };

  useEffect(() => {
    initializationRef.current ??= (async () => {
      let items = await window.trajectory.listConversations();
      const conversation = items[0]
        ? await window.trajectory.getConversation(items[0].id)
        : await window.trajectory.createConversation();
      if (!items[0]) {
        items = await window.trajectory.listConversations();
      }
      return { conversation, summaries: items };
    })();
    let cancelled = false;
    void initializationRef.current
      .then(({ conversation, summaries: items }) => {
        if (!cancelled) {
          setSummaries(items);
          setActive(conversation);
        }
      })
      .catch((initializationError: unknown) => {
        if (!cancelled) {
          setError(toErrorMessage(initializationError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      window.trajectory.onChatStream((delta) => {
        if (activeRequestRef.current !== delta.requestId) return;
        setActive((current) => {
          if (!current || current.id !== delta.conversationId) return current;
          const streamId = `stream-${delta.requestId}`;
          return {
            ...current,
            messages: current.messages.map((item) =>
              item.id === streamId
                ? { ...item, content: item.content + delta.content }
                : item,
            ),
          };
        });
      }),
    [],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages, sending]);

  const title = useMemo(
    () => active?.title ?? "New conversation",
    [active?.title],
  );

  const send = async (content: string): Promise<void> => {
    const message = content.trim();
    if (!message || !active || sending) {
      return;
    }
    setDraft("");
    setError(null);
    setSending(true);
    const requestId = crypto.randomUUID();
    activeRequestRef.current = requestId;
    const optimistic: ChatMessage = {
      id: `pending-${Date.now().toString()}`,
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
    };
    const streaming: ChatMessage = {
      id: `stream-${requestId}`,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };
    setActive({
      ...active,
      messages: [...active.messages, optimistic, streaming],
    });
    try {
      const conversation = await window.trajectory.sendMessage({
        requestId,
        conversationId: active.id,
        content: message,
        provider,
      });
      setActive((current) =>
        current?.id === conversation.id ? conversation : current,
      );
      await refreshSummaries();
    } catch (sendError) {
      setError(toErrorMessage(sendError));
      try {
        const reloaded = await window.trajectory.getConversation(active.id);
        setActive((current) =>
          current?.id === reloaded.id ? reloaded : current,
        );
        await refreshSummaries();
      } catch (reloadError) {
        setError(toErrorMessage(reloadError));
      }
    } finally {
      if (activeRequestRef.current === requestId) {
        activeRequestRef.current = null;
      }
      setSending(false);
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void send(draft);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) {
        void send(draft);
      }
    }
  };

  const removeConversation = async (
    event: React.MouseEvent,
    id: string,
  ): Promise<void> => {
    event.stopPropagation();
    if (!window.confirm("Delete this encrypted conversation?")) {
      return;
    }
    try {
      await window.trajectory.deleteConversation(id);
      const items = await refreshSummaries();
      if (id === activeId) {
        if (items[0]) {
          await openConversation(items[0].id);
        } else {
          await newConversation();
        }
      }
    } catch (deleteError) {
      setError(toErrorMessage(deleteError));
    }
  };

  return (
    <>
      <aside className="sidebar">
        <button className="new-chat" onClick={() => void newConversation()}>
          <span>+</span> New conversation
        </button>
        <div className="conversation-list">
          {summaries.map((conversation) => (
            <div
              className={`conversation-item ${
                conversation.id === activeId ? "active" : ""
              }`}
              key={conversation.id}
            >
              <button
                className="conversation-open"
                onClick={() => void openConversation(conversation.id)}
              >
                <span className="conversation-title">{conversation.title}</span>
              </button>
              <button
                className="delete-chat"
                onClick={(event) =>
                  void removeConversation(event, conversation.id)
                }
                aria-label={`Delete ${conversation.title}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <span className="lock">●</span>
          History encrypted on this device
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <h1>{title}</h1>
            <span>{mentorName}</span>
            {mentorDisclaimer && (
              <p className="mentor-disclaimer">{mentorDisclaimer}</p>
            )}
          </div>
          <label className="provider-control">
            <span>Model</span>
            <select
              value={provider}
              onChange={(event) =>
                onChangeProvider(event.target.value as ProviderName)
              }
              disabled={sending}
            >
              <option value="copilot">GitHub Copilot</option>
              <option value="openai">OpenAI-compatible</option>
              <option value="deterministic">Demo provider</option>
            </select>
          </label>
        </header>

        <section className="messages" aria-live="polite">
          {loading ? (
            <div className="center-state">Loading encrypted conversations…</div>
          ) : active?.messages.length ? (
            <>
              {active.messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
              {sending &&
                active?.messages.at(-1)?.content.length === 0 && (
                <div className="thinking">
                  <span />
                  <span />
                  <span />
                </div>
                )}
            </>
          ) : (
            <div className="welcome">
              <div className="welcome-mark">T</div>
              <h2>What deserves your attention?</h2>
              <p>
                Ask about a decision, a tradeoff, or where your current actions
                point.
              </p>
              <div className="suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} onClick={() => void send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </section>

        <footer className="composer-wrap">
          {error && <div className="error-banner">{error}</div>}
          <form className="composer" onSubmit={submit}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Trajectory anything…"
              rows={1}
              maxLength={12_000}
              disabled={sending || !active}
            />
            <button type="submit" disabled={!canSend} aria-label="Send message">
              ↑
            </button>
          </form>
          <p>
            Trajectory can be wrong. Review important decisions and provider
            privacy policies.
          </p>
        </footer>
      </main>
    </>
  );
}
