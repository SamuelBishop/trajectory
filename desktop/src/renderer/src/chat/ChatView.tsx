/**
 * Chat: the grounded follow-up, secondary to the briefing.
 *
 * Three columns, in the order they are used: which conversation, the
 * conversation itself, and what the last answer was built from. The evidence
 * column is the reason this is not a generic chat window — an answer about the
 * user's life is only worth reading if what it read is one glance away.
 *
 * Implements: [HC-RENDERER-IS-UNTRUSTED], [SC-UNCERTAINTY-DECLARED]
 */

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  ChatMessage,
  Conversation,
  ConversationSummary,
  Grounding,
  ProviderName,
  StarterPromptCacheView,
} from "../../../shared/types";
import { toErrorMessage } from "../errors";
import type { Route } from "../route";
import { Mark } from "../ui/Mark";
import { Icon } from "../ui/Icon";
import { ConversationList } from "./ConversationList";
import { EvidenceSidebar } from "./EvidenceSidebar";
import { Message } from "./Message";

/** The answer whose evidence is shown when the user has not picked one. */
function latestGrounded(messages: readonly ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.grounding) return message;
  }
  return null;
}

export interface ChatViewProps {
  readonly provider: ProviderName;
  readonly onChangeProvider: (provider: ProviderName) => void;
  readonly mentorName: string;
  readonly mentorDisclaimer: string;
  readonly displayName: string;
  readonly onNavigate: (next: Route) => void;
  /**
   * A question handed over from Today. Placed in the composer rather than sent,
   * because the user asked to *ask about* a priority, not to have it asked for
   * them — and the wording is usually worth editing first.
   */
  readonly seed: string | null;
  readonly onSeedUsed: () => void;
}

export function ChatView({
  provider,
  onChangeProvider,
  mentorName,
  mentorDisclaimer,
  displayName,
  onNavigate,
  seed,
  onSeedUsed,
}: ChatViewProps): React.JSX.Element {
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Which answer's evidence is shown. Null follows the newest one. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const endRef = useRef<HTMLDivElement>(null);
  const activeRequestRef = useRef<string | null>(null);
  const initializationRef = useRef<Promise<{
    conversation: Conversation;
    summaries: ConversationSummary[];
  }> | null>(null);

  const [starterPrompts, setStarterPrompts] = useState<string[] | null>(null);
  const [starterLoading, setStarterLoading] = useState(false);
  const [starterError, setStarterError] = useState<string | null>(null);
  const starterPromptsRef = useRef<string[] | null>(null);
  const starterCacheRequestRef = useRef<{
    provider: ProviderName;
    promise: Promise<StarterPromptCacheView>;
  } | null>(null);
  const starterRefreshRequestRef = useRef<{
    provider: ProviderName;
    promise: Promise<string[]>;
  } | null>(null);

  const activeId = active?.id;
  const canSend = draft.trim().length > 0 && !sending && Boolean(activeId);

  const refreshSummaries = async (): Promise<ConversationSummary[]> => {
    const items = await window.trajectory.listConversations();
    setSummaries(items);
    return items;
  };

  const openConversation = async (id: string): Promise<void> => {
    setError(null);
    setSelectedId(null);
    const conversation = await window.trajectory.getConversation(id);
    setActive(conversation);
  };

  const newConversation = useCallback(async (): Promise<void> => {
    setError(null);
    setSelectedId(null);
    const conversation = await window.trajectory.createConversation();
    setActive(conversation);
    await refreshSummaries();
  }, []);

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

  useEffect(() => {
    // The list shows "4:32 PM" and "Yesterday"; both go stale in a window left
    // open overnight.
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void newConversation();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newConversation]);

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

  useEffect(() => {
    // Consumed once. Clearing it here rather than on unmount means returning to
    // Chat later does not refill the composer with a question already answered.
    if (seed === null) return;
    setDraft(seed);
    onSeedUsed();
  }, [seed, onSeedUsed]);

  const title = useMemo(
    () => active?.title ?? "New conversation",
    [active?.title],
  );

  const messages = active?.messages ?? [];
  // The initial reads as a person; "You" beside the label "You" reads as a bug.
  const youMark = displayName.trim().slice(0, 1).toUpperCase() || "You";

  const showStarterPrompts = useCallback((prompts: string[]): void => {
    starterPromptsRef.current = prompts;
    setStarterPrompts(prompts);
  }, []);

  const getStarterCache = useCallback((): Promise<StarterPromptCacheView> => {
    const current = starterCacheRequestRef.current;
    if (current?.provider === provider) {
      return current.promise;
    }
    const promise = window.trajectory.getStarterPrompts();
    starterCacheRequestRef.current = { provider, promise };
    void promise.then(undefined, () => {
      if (starterCacheRequestRef.current?.promise === promise) {
        starterCacheRequestRef.current = null;
      }
    });
    return promise;
  }, [provider]);

  const refreshStarters = useCallback((): Promise<string[]> => {
    const current = starterRefreshRequestRef.current;
    if (current?.provider === provider) {
      return current.promise;
    }
    const promise = window.trajectory.refreshStarterPrompts();
    starterRefreshRequestRef.current = { provider, promise };
    const clear = (): void => {
      if (starterRefreshRequestRef.current?.promise === promise) {
        starterRefreshRequestRef.current = null;
      }
    };
    void promise.then(clear, clear);
    return promise;
  }, [provider]);

  const showFreshStarterPrompts = useCallback(
    (prompts: string[]): void => {
      showStarterPrompts(prompts);
      starterCacheRequestRef.current = {
        provider,
        promise: Promise.resolve({ prompts, fresh: true }),
      };
    },
    [provider, showStarterPrompts],
  );

  // A shared cache promise and refresh promise let both StrictMode effect passes
  // observe the same work. A one-shot boolean would let the cancelled first pass
  // consume the refresh and leave the live pass with no result.
  const isEmpty = messages.length === 0 && !loading;
  useEffect(() => {
    if (!isEmpty) return;
    let cancelled = false;
    if (starterPromptsRef.current === null) {
      setStarterLoading(true);
    }
    void (async () => {
      try {
        const cached = await getStarterCache();
        if (cancelled) return;
        if (cached.prompts) {
          showStarterPrompts(cached.prompts);
        }
        if (!cached.fresh) {
          setStarterLoading(true);
          try {
            const refreshed = await refreshStarters();
            if (!cancelled) {
              showFreshStarterPrompts(refreshed);
              setStarterError(null);
            }
          } catch (refreshError) {
            if (!cancelled) {
              setStarterError(toErrorMessage(refreshError));
            }
          } finally {
            if (!cancelled) setStarterLoading(false);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setStarterError(toErrorMessage(loadError));
          setStarterLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    getStarterCache,
    isEmpty,
    refreshStarters,
    showFreshStarterPrompts,
    showStarterPrompts,
  ]);

  const handleRefreshStarters = useCallback(async () => {
    setStarterLoading(true);
    setStarterError(null);
    try {
      const refreshed = await refreshStarters();
      showFreshStarterPrompts(refreshed);
    } catch (refreshError) {
      setStarterError(toErrorMessage(refreshError));
    } finally {
      setStarterLoading(false);
    }
  }, [refreshStarters, showFreshStarterPrompts]);

  const evidenceMessage =
    (selectedId === null
      ? null
      : (messages.find((item) => item.id === selectedId) ?? null)) ??
    latestGrounded(messages);
  const grounding: Grounding | null = evidenceMessage?.grounding ?? null;

  const send = async (content: string): Promise<void> => {
    const message = content.trim();
    if (!message || !active || sending) {
      return;
    }
    setDraft("");
    setError(null);
    setSending(true);
    setSelectedId(null);
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

  const removeActive = async (): Promise<void> => {
    if (!activeId) return;
    setMenuOpen(false);
    if (!window.confirm("Delete this encrypted conversation?")) {
      return;
    }
    try {
      await window.trajectory.deleteConversation(activeId);
      const items = await refreshSummaries();
      if (items[0]) {
        await openConversation(items[0].id);
      } else {
        await newConversation();
      }
    } catch (deleteError) {
      setError(toErrorMessage(deleteError));
    }
  };

  return (
    <>
      <ConversationList
        summaries={summaries}
        activeId={activeId}
        now={now}
        onOpen={(id) => void openConversation(id)}
        onCreate={() => void newConversation()}
      />

      <main className="chat-panel">
        <header className="chat-header">
          <div className="chat-heading">
            <h1>{title}</h1>
            <span>{mentorName}</span>
            {mentorDisclaimer && (
              <p className="mentor-disclaimer">{mentorDisclaimer}</p>
            )}
          </div>
          <div className="chat-header-controls">
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
            <div className="overflow">
              <button
                type="button"
                className="icon-button"
                aria-label="Conversation actions"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                ⋯
              </button>
              {menuOpen && (
                <>
                  <button
                    type="button"
                    className="overflow-scrim"
                    aria-label="Close menu"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="overflow-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void newConversation()}
                    >
                      New conversation
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      disabled={!activeId}
                      onClick={() => void removeActive()}
                    >
                      Delete conversation
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div className="chat-body">
          <section className="messages" aria-live="polite">
            {loading ? (
              <div className="center-state">
                Loading encrypted conversations…
              </div>
            ) : messages.length ? (
              <>
                {messages.map((message) => (
                  <Message
                    key={message.id}
                    message={message}
                    youMark={youMark}
                    selected={message.id === evidenceMessage?.id}
                    onSelect={() => setSelectedId(message.id)}
                  />
                ))}
                {sending && messages.at(-1)?.content.length === 0 && (
                  <div className="thinking">
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </>
            ) : (
              <div className="welcome">
                <div className="welcome-mark">
                  <Mark />
                </div>
                <h2>What deserves your attention?</h2>
                <p>
                  Ask about a decision, a tradeoff, or where your current actions
                  point.
                </p>
                {starterError && !starterPrompts && (
                  <div className="error-banner">
                    {starterError}{" "}
                    <button
                      type="button"
                      className="suggestions-refresh"
                      onClick={() => void handleRefreshStarters()}
                    >
                      Retry
                    </button>
                  </div>
                )}
                {starterPrompts ? (
                  <>
                    <div className="suggestions">
                      {starterPrompts.map((question) => (
                        <button
                          key={question}
                          onClick={() => void send(question)}
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                    <div className="suggestion-actions">
                      {starterError && (
                        <span className="save-problem">{starterError}</span>
                      )}
                      <button
                        type="button"
                        className="suggestions-refresh"
                        disabled={starterLoading}
                        onClick={() => void handleRefreshStarters()}
                      >
                        {starterLoading
                          ? "Refreshing…"
                          : "Refresh suggestions"}
                      </button>
                    </div>
                  </>
                ) : starterLoading ? (
                  <div className="suggestions">
                    <span>Generating personalized suggestions…</span>
                  </div>
                ) : null}
              </div>
            )}
            <div ref={endRef} />
          </section>

          <EvidenceSidebar
            grounding={grounding}
            mentorName={mentorName}
            mentorDisclaimer={mentorDisclaimer}
            onNavigate={onNavigate}
          />
        </div>

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
              <Icon name="chevron" size={16} />
              <kbd>↵</kbd>
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
