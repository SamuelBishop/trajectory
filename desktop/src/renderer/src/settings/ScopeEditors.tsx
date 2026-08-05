/**
 * What each integration is allowed to read.
 *
 * Implements: [HC-RENDERER-IS-UNTRUSTED], [HC-NO-EXFILTRATION]
 *
 * Scope is the narrowest of the three controls on an integration's page: not
 * whether it runs, but which repository, database, or spreadsheet it may open.
 * Nothing is validated here. The main process re-parses every scope before
 * writing it, because that is the value deciding what an adapter may reach.
 */

import { useEffect, useState } from "react";

import type {
  AuthorizeOutcome,
  GitHubScopeView,
  GoogleSheetsScopeView,
  IntegrationsView,
  NotionScopeView,
  StravaScopeView,
} from "../../../shared/types";
import { attempt, toErrorMessage } from "../errors";
import { useSavedDraft } from "../draft";
import { Field, NumberInput, Select, TagInput, TextInput, Toggle } from "../FormKit";


/**
 * Which repositories GitHub may be read from, and which goal each one serves.
 *
 * The domain map is the part that makes the mentor useful rather than merely
 * informed. `ActivitySignal.domain` has to equal a `Goal.domain` before
 * selection will connect a commit to a goal, and a repository name almost never
 * does — so the goals you actually have are offered here as suggestions, and an
 * unmapped repository is called out rather than left to fail quietly.
 */
export function GitHubScopeEditor({
  scope,
  goalDomains,
  busy,
  onRun,
}: {
  readonly scope: GitHubScopeView;
  readonly goalDomains: readonly string[];
  readonly busy: boolean;
  readonly onRun: (action: () => Promise<IntegrationsView>) => void;
}): React.JSX.Element {
  const { draft, setDraft, dirty } = useSavedDraft(scope);

  const targets = [...draft.repositories, ...draft.organizations].filter(
    (entry) => entry.length > 0,
  );
  const unmapped = targets.filter(
    (entry) => (draft.domains[entry] ?? "").length === 0,
  );

  return (
    <>
      <Field
        label="GitHub username"
        hint="Whose commits to read. Only commits you authored are collected."
      >
        <TextInput
          value={draft.login}
          disabled={busy}
          placeholder="octocat"
          onChange={(login) => setDraft({ ...draft, login })}
        />
      </Field>

      <Field
        label="Days to look back"
        hint="How recent a commit must be. A week keeps the mentor on what you are doing now."
      >
        <NumberInput
          value={draft.lookbackDays}
          min={1}
          max={365}
          disabled={busy}
          onChange={(lookbackDays) => setDraft({ ...draft, lookbackDays })}
        />
      </Field>

      <Toggle
        label="Read every repository I can access"
        checked={draft.allRepositories}
        disabled={busy}
        onChange={(allRepositories) => setDraft({ ...draft, allRepositories })}
      />

      {!draft.allRepositories && (
        <>
          <Field
            label="Repositories"
            hint="Comma separated, as owner/name. Empty means nothing is read at all."
          >
            <TagInput
              value={draft.repositories}
              disabled={busy}
              placeholder="octocat/api-service, octocat/side-project"
              onChange={(repositories) => setDraft({ ...draft, repositories })}
            />
          </Field>

          <Field
            label="Organizations"
            hint="Comma separated. Widens scope to every repository in the organization."
          >
            <TagInput
              value={draft.organizations}
              disabled={busy}
              placeholder="my-org"
              onChange={(organizations) => setDraft({ ...draft, organizations })}
            />
          </Field>
        </>
      )}

      {!draft.allRepositories && targets.length > 0 && (
        <>
          <p className="field-hint">
            Optional. Recent commits reach the mentor either way, and it reads
            the repository name and commit message to work out which goal they
            serve. Map one only when its name says nothing useful.
          </p>
          {targets.map((entry) => (
            <Field key={entry} label={entry}>
              <TextInput
                value={draft.domains[entry] ?? ""}
                disabled={busy}
                placeholder={
                  goalDomains.length > 0
                    ? `e.g. ${goalDomains.join(", ")}`
                    : "a goal domain"
                }
                onChange={(domain) =>
                  setDraft({
                    ...draft,
                    domains: { ...draft.domains, [entry]: domain },
                  })
                }
              />
            </Field>
          ))}
        </>
      )}

      {unmapped.length > 0 && (
        <p className="field-hint">
          Not yet mapped to a goal: {unmapped.join(", ")}.
        </p>
      )}

      <div className="save-bar">
        <span className="save-status">
          {dirty ? "Unsaved GitHub settings." : ""}
        </span>
        <button
          type="button"
          className={dirty ? "primary" : undefined}
          disabled={busy || !dirty}
          onClick={() => onRun(() => window.trajectory.saveGitHubScope(draft))}
        >
          Save GitHub settings
        </button>
      </div>
    </>
  );
}


/**
 * Which Notion database may be read, and how to interpret its columns.
 *
 * Every property name is a field because no two task databases share a schema.
 * Notion has no canonical "status" column — it is whatever the user named it —
 * so a hardcoded name would work for one person and silently return nothing for
 * everyone else. The adapter reports a name that matches nothing rather than
 * storing zero tasks and letting it read as a quiet week.
 */
export function NotionScopeEditor({
  scope,
  goalDomains,
  busy,
  onRun,
}: {
  readonly scope: NotionScopeView;
  readonly goalDomains: readonly string[];
  readonly busy: boolean;
  readonly onRun: (action: () => Promise<IntegrationsView>) => void;
}): React.JSX.Element {
  const { draft, setDraft, dirty } = useSavedDraft(scope);
  const domainHint =
    goalDomains.length > 0 ? `e.g. ${goalDomains.join(", ")}` : "a goal domain";

  return (
    <>
      <Field
        label="Database"
        hint="Paste the database URL from Notion, or its ID. Empty means nothing is read at all."
      >
        <TextInput
          value={draft.databaseId}
          disabled={busy}
          placeholder="https://www.notion.so/…"
          onChange={(databaseId) => setDraft({ ...draft, databaseId })}
        />
      </Field>

      <p className="field-hint">
        The database also has to be connected to your integration from
        Notion&rsquo;s ••• menu. Creating the integration does not grant it
        access on its own.
      </p>

      <Field
        label="Where the tasks are"
        hint="Rows: each row is one task. Checkboxes: each row is a day, and the to-do boxes written inside it are the tasks."
      >
        <Select
          value={draft.taskSource}
          disabled={busy}
          options={[
            { value: "rows", label: "Each row is a task" },
            { value: "checkboxes", label: "Checkboxes inside each page" },
          ]}
          onChange={(taskSource) => setDraft({ ...draft, taskSource })}
        />
      </Field>

      <Field
        label="Days to look back"
        hint="How far the first sync reaches. Later syncs resume from the last one."
      >
        <NumberInput
          value={draft.lookbackDays}
          min={1}
          max={365}
          disabled={busy}
          onChange={(lookbackDays) => setDraft({ ...draft, lookbackDays })}
        />
      </Field>

      {draft.taskSource === "checkboxes" && (
        <>
          <Field
            label="Date property"
            hint="The date column on each daily page. Every box ticked on that page is dated by it."
          >
            <TextInput
              value={draft.dateProperty}
              disabled={busy}
              placeholder="Date"
              onChange={(dateProperty) => setDraft({ ...draft, dateProperty })}
            />
          </Field>
          <p className="field-hint">
            A real date column rather than the page title. A page called
            &ldquo;July 30&rdquo; carries no year, so dating a task from its name
            means guessing one.
          </p>
        </>
      )}

      {draft.taskSource === "rows" && (
      <>
      <Field label="Title property" hint="The column holding the task name.">
        <TextInput
          value={draft.titleProperty}
          disabled={busy}
          placeholder="Name"
          onChange={(titleProperty) => setDraft({ ...draft, titleProperty })}
        />
      </Field>

      <Field
        label="Status property"
        hint="The column that says whether a task is done. A status, select, or checkbox."
      >
        <TextInput
          value={draft.statusProperty}
          disabled={busy}
          placeholder="Status"
          onChange={(statusProperty) => setDraft({ ...draft, statusProperty })}
        />
      </Field>

      <Field
        label="Values that mean done"
        hint="Comma separated, matched ignoring case. Ignored when the status column is a checkbox."
      >
        <TagInput
          value={draft.doneValues}
          disabled={busy}
          placeholder="Done, Shipped"
          onChange={(doneValues) => setDraft({ ...draft, doneValues })}
        />
      </Field>

      <Field
        label="Completed date property"
        hint="Optional. When a task was finished. Falls back to when it was last edited."
      >
        <TextInput
          value={draft.completedProperty}
          disabled={busy}
          placeholder="Completed on"
          onChange={(completedProperty) =>
            setDraft({ ...draft, completedProperty })
          }
        />
      </Field>

      <Field
        label="Due date property"
        hint="Optional. Used to date tasks that are not finished."
      >
        <TextInput
          value={draft.dueProperty}
          disabled={busy}
          placeholder="Due"
          onChange={(dueProperty) => setDraft({ ...draft, dueProperty })}
        />
      </Field>

      </>
      )}

      <Field
        label="Domain property"
        hint="Optional. A select column naming which goal a task serves."
      >
        <TextInput
          value={draft.domainProperty}
          disabled={busy}
          placeholder="Area"
          onChange={(domainProperty) => setDraft({ ...draft, domainProperty })}
        />
      </Field>

      <Field
        label="Default domain"
        hint="Used when no domain column is mapped, or when a task leaves it blank."
      >
        <TextInput
          value={draft.defaultDomain}
          disabled={busy}
          placeholder={domainHint}
          onChange={(defaultDomain) => setDraft({ ...draft, defaultDomain })}
        />
      </Field>

      <Toggle
        label={
          draft.taskSource === "checkboxes"
            ? "Also collect boxes that are not ticked"
            : "Also collect tasks that are not finished"
        }
        checked={draft.includeOpenTasks}
        disabled={busy}
        onChange={(includeOpenTasks) => setDraft({ ...draft, includeOpenTasks })}
      />

      <p className="field-hint">
        An unfinished item records what you meant to do; a finished one records
        what you did. Trajectory stores which is which, so the mentor can tell
        you what is still outstanding without ever counting it as done.
      </p>

      <div className="save-bar">
        <span className="save-status">
          {dirty ? "Unsaved Notion settings." : ""}
        </span>
        <button
          type="button"
          className={dirty ? "primary" : undefined}
          disabled={busy || !dirty}
          onClick={() => onRun(() => window.trajectory.saveNotionScope(draft))}
        >
          Save Notion settings
        </button>
      </div>
    </>
  );
}

/**
 * Strava's scope is short because there is nothing to interpret.
 *
 * A recorded activity has one shape, so unlike Notion there are no column names
 * to configure — only which application to use and which goal the training
 * serves. The two credentials are not here: they live in Settings under
 * Credentials, where every other secret is, and no channel reads one back.
 */
export function StravaScopeEditor({
  scope,
  goalDomains,
  busy,
  onRun,
}: {
  readonly scope: StravaScopeView;
  readonly goalDomains: readonly string[];
  readonly busy: boolean;
  readonly onRun: (action: () => Promise<IntegrationsView>) => void;
}): React.JSX.Element {
  const { draft, setDraft, dirty } = useSavedDraft(scope);
  const domainHint =
    goalDomains.length > 0 ? `e.g. ${goalDomains.join(", ")}` : "a goal domain";

  return (
    <>
      <Field
        label="Client ID"
        hint="From strava.com/settings/api. Empty means nothing is read at all."
      >
        <TextInput
          value={draft.clientId}
          disabled={busy}
          placeholder="123456"
          onChange={(clientId) => setDraft({ ...draft, clientId })}
        />
      </Field>

      <p className="field-hint">
        The client secret and refresh token go under Credentials. Authorize the
        application with the <code>activity:read_all</code> scope, or reuse a
        refresh token you already minted for it.
      </p>

      <Field
        label="Goal domain"
        hint={`Which goal these workouts count towards — ${domainHint}.`}
      >
        <TextInput
          value={draft.defaultDomain}
          disabled={busy}
          placeholder="running"
          onChange={(defaultDomain) => setDraft({ ...draft, defaultDomain })}
        />
      </Field>

      <Field
        label="Days to look back"
        hint="How far the first sync reaches. Later syncs resume from the last one."
      >
        <NumberInput
          value={draft.lookbackDays}
          min={1}
          max={365}
          disabled={busy}
          onChange={(lookbackDays) => setDraft({ ...draft, lookbackDays })}
        />
      </Field>

      <p className="field-hint">
        Every activity type is collected, not only runs. A training plan fails
        through overtraining as often as through undertraining, so the recovery
        and cross-training days are the ones that answer whether you are on
        track. Routes and GPS coordinates are never read or stored.
      </p>

      <StravaAuthorizeHelper busy={busy} />

      <div className="save-bar">
        <span className="save-status">
          {dirty ? "Unsaved Strava settings." : ""}
        </span>
        <button
          type="button"
          className={dirty ? "primary" : undefined}
          disabled={busy || !dirty}
          onClick={() => onRun(() => window.trajectory.saveStravaScope(draft))}
        >
          Save Strava settings
        </button>
      </div>
    </>
  );
}

/**
 * Which spreadsheet may be read, and how to interpret its columns.
 *
 * Longer than Strava's because a spreadsheet has no schema. A workout recorded
 * by a watch has one shape; a training log has whatever shape its author chose,
 * so every column name is a setting.
 *
 * The two rows at the top are the field people get wrong. A log written by a
 * coach usually has an explanatory row under the headers — "effort, 1 to 5" —
 * and reading it as data produces one undated junk row on every sync.
 */
export function GoogleSheetsScopeEditor({
  scope,
  goalDomains,
  busy,
  onRun,
}: {
  readonly scope: GoogleSheetsScopeView;
  readonly goalDomains: readonly string[];
  readonly busy: boolean;
  readonly onRun: (action: () => Promise<IntegrationsView>) => void;
}): React.JSX.Element {
  const { draft, setDraft, dirty } = useSavedDraft(scope);
  const domainHint =
    goalDomains.length > 0 ? `e.g. ${goalDomains.join(", ")}` : "a goal domain";

  return (
    <>
      <Field
        label="Spreadsheet"
        hint="Paste the address of the sheet. Empty means nothing is read at all."
      >
        <TextInput
          value={draft.spreadsheetId}
          disabled={busy}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          onChange={(spreadsheetId) => setDraft({ ...draft, spreadsheetId })}
        />
      </Field>

      {draft.clientEmail.length === 0 ? (
        <p className="field-hint">
          No service account stored yet. Add one under Credentials in Settings,
          then share this sheet with the address it shows.
        </p>
      ) : (
        <p className="field-hint">
          Share the sheet with <code>{draft.clientEmail}</code> as a Viewer.
          Trajectory can read nothing until you do — a service account starts
          with access to no file at all.
        </p>
      )}

      <Field label="Tab" hint="Empty means the first tab in the workbook.">
        <TextInput
          value={draft.tabName}
          disabled={busy}
          placeholder="2026"
          onChange={(tabName) => setDraft({ ...draft, tabName })}
        />
      </Field>

      <Field label="Header row" hint="The row holding the column names.">
        <NumberInput
          value={draft.headerRow}
          min={1}
          max={1000}
          disabled={busy}
          onChange={(headerRow) => setDraft({ ...draft, headerRow })}
        />
      </Field>

      <Field
        label="First row of data"
        hint="Not always the row after the headers. Set it past any explanatory row, or that row is read as a workout."
      >
        <NumberInput
          value={draft.firstDataRow}
          min={1}
          max={1000}
          disabled={busy}
          onChange={(firstDataRow) => setDraft({ ...draft, firstDataRow })}
        />
      </Field>

      <Field label="Date column" hint="Which day the row describes.">
        <TextInput
          value={draft.dateColumn}
          disabled={busy}
          placeholder="Date"
          onChange={(dateColumn) => setDraft({ ...draft, dateColumn })}
        />
      </Field>

      <Field
        label="Planned column"
        hint="What the session was supposed to be."
      >
        <TextInput
          value={draft.plannedColumn}
          disabled={busy}
          placeholder="Workout"
          onChange={(plannedColumn) => setDraft({ ...draft, plannedColumn })}
        />
      </Field>

      <Field
        label="Completed column"
        hint="What was actually done. An empty cell is read as a session that did not happen."
      >
        <TextInput
          value={draft.actualColumn}
          disabled={busy}
          placeholder="Actual"
          onChange={(actualColumn) => setDraft({ ...draft, actualColumn })}
        />
      </Field>

      <p className="field-hint">
        These two columns are the reason this integration is worth having.
        Nothing else Trajectory reads can tell the difference between a session
        you skipped and a session you never planned — a fitness tracker has no
        record of a run that did not happen. This sheet does.
      </p>

      <Field
        label="Numeric columns"
        hint="Comma separated. Kept as numbers the mentor can compare week to week."
      >
        <TagInput
          value={draft.metricColumns}
          disabled={busy}
          placeholder="Running Miles, RPE, Work load"
          onChange={(metricColumns) => setDraft({ ...draft, metricColumns })}
        />
      </Field>

      <Field
        label="Note columns"
        hint="Comma separated. Off by default — these carry the most personal text in the sheet."
      >
        <TagInput
          value={draft.noteColumns}
          disabled={busy}
          placeholder="Notes, Comments from coach"
          onChange={(noteColumns) => setDraft({ ...draft, noteColumns })}
        />
      </Field>

      <Field
        label="Goal domain"
        hint={`Which goal these sessions count towards — ${domainHint}.`}
      >
        <TextInput
          value={draft.defaultDomain}
          disabled={busy}
          placeholder="training"
          onChange={(defaultDomain) => setDraft({ ...draft, defaultDomain })}
        />
      </Field>

      <Field
        label="Days to look back"
        hint="How far back to read. The whole window is re-read each time, so a row filled in late is still picked up."
      >
        <NumberInput
          value={draft.lookbackDays}
          min={1}
          max={365}
          disabled={busy}
          onChange={(lookbackDays) => setDraft({ ...draft, lookbackDays })}
        />
      </Field>

      <p className="field-hint">
        Rows dated in the future are not collected. A session planned for next
        week has not been missed, and counting it as one would turn a training
        block into a list of failures.
      </p>

      <div className="save-bar">
        <span className="save-status">
          {dirty ? "Unsaved spreadsheet settings." : ""}
        </span>
        <button
          type="button"
          className={dirty ? "primary" : undefined}
          disabled={busy || !dirty}
          onClick={() =>
            onRun(() => window.trajectory.saveGoogleSheetsScope(draft))
          }
        >
          Save spreadsheet settings
        </button>
      </div>
    </>
  );
}

/**
 * Getting a refresh token that can actually read activities.
 *
 * This is not a convenience. `strava.com/settings/api` shows an access token
 * and a refresh token right under the client secret, and they are issued with
 * `read` scope, which cannot list activities. Copying them is the obvious move
 * and it produces a setup that authenticates correctly and then fails on every
 * sync — the token endpoint returns 200 and the activity request returns 401.
 * Nothing on that page hints at it. So the app asks for the scope itself
 * rather than leaving the user to discover which of the two tokens was wrong.
 */
function StravaAuthorizeHelper({
  busy,
}: {
  readonly busy: boolean;
}): React.JSX.Element {
  const [pasted, setPasted] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const settle = (action: () => Promise<AuthorizeOutcome>, done: string): void => {
    setWorking(true);
    setNote(null);
    void attempt(action)
      .then((outcome) => {
        setNote(outcome.ok ? done : outcome.problem);
        if (outcome.ok) {
          setPasted("");
        }
      })
      .catch((error: unknown) => {
        setNote(toErrorMessage(error));
      })
      .finally(() => {
        setWorking(false);
      });
  };

  return (
    <div className="subsection">
      <p className="field-hint">
        The refresh token shown on Strava&apos;s own API settings page will not
        work: it is issued with <code>read</code> scope and cannot list
        activities. Use this instead — it asks for{" "}
        <code>activity:read_all</code> and stores the result.
      </p>
      <div className="save-bar">
        <span className="save-status">{note ?? ""}</span>
        <button
          type="button"
          disabled={busy || working}
          onClick={() =>
            settle(
              () => window.trajectory.openStravaAuthorize(),
              "Authorize in the browser, then paste the address it lands on.",
            )
          }
        >
          Authorize on Strava
        </button>
      </div>
      <Field
        label="Redirect address"
        hint="The page will fail to load. That is expected — copy the whole address and paste it here."
      >
        <input
          className="text-input"
          type="text"
          value={pasted}
          placeholder="http://localhost/exchange_token?state=&code=..."
          autoComplete="off"
          spellCheck={false}
          disabled={busy || working}
          onChange={(event) => setPasted(event.target.value)}
        />
      </Field>
      <div className="save-bar">
        <span className="save-status" />
        <button
          type="button"
          className={pasted.trim().length > 0 ? "primary" : undefined}
          disabled={busy || working || pasted.trim().length === 0}
          onClick={() =>
            settle(
              () => window.trajectory.completeStravaAuthorize(pasted),
              "Refresh token stored. Press Refresh to sync.",
            )
          }
        >
          Store refresh token
        </button>
      </div>
    </div>
  );
}
