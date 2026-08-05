/**
 * What to do today, and what to be careful about.
 *
 * Each priority carries one action — ask about it — because the daily loop ends
 * either in doing the work or in one grounded follow-up question. A row that
 * expanded to reveal nothing would be a chevron that lies.
 *
 * The mentor's schema caps this at three. That cap is the feature: a list of
 * ten priorities is a list of none.
 */

import { Card, CardHeader } from "../ui/Card";
import { Icon } from "../ui/Icon";

export function PrioritiesCard({
  priorities,
  onAsk,
}: {
  readonly priorities: readonly string[];
  readonly onAsk: (question: string) => void;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Today's priorities" />
      <ol className="priority-list">
        {priorities.map((priority, index) => (
          <li key={priority}>
            <span className="priority-rank">{index + 1}</span>
            <span className="priority-text">{priority}</span>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                onAsk(`About today's priority "${priority}" — where should I start?`)
              }
            >
              Ask about this
              <Icon name="chevron" size={14} />
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function WatchOutCard({
  text,
  onAsk,
}: {
  readonly text: string;
  readonly onAsk: (question: string) => void;
}): React.JSX.Element {
  return (
    <Card tone="warning">
      <CardHeader title="Watch out for" />
      <div className="watch-out">
        <Icon name="warning" size={20} />
        <p>{text}</p>
        <button
          type="button"
          className="ghost"
          onClick={() => onAsk(`You flagged: "${text}". What should I change?`)}
        >
          Ask about this
        </button>
      </div>
    </Card>
  );
}
