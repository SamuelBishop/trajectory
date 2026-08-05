/**
 * Where the window is pointing.
 *
 * One place rather than a `useState` per view, because four different things
 * move it: the rail, a notification arriving, a link out of the briefing into
 * the context that produced it, and a source row asking for its own settings
 * page. A view that owned its own selection could not be sent anywhere by the
 * other three.
 *
 * `sub` is deliberately a plain string. Its meaning belongs to the view that
 * reads it — a briefing sub-page, a context section, an integration id — and
 * naming every possibility here would put four views' internals in one type.
 */

export type ViewName = "today" | "chat" | "context" | "settings";

export interface Route {
  readonly view: ViewName;
  readonly sub: string | null;
}

export const HOME: Route = { view: "today", sub: null };

export function routeTo(view: ViewName, sub: string | null = null): Route {
  return { view, sub };
}
