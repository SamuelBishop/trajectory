export type ProviderName = "deterministic" | "copilot" | "openai";
export const ZOOM_PRESETS = [80, 90, 100, 110, 120] as const;
export type ZoomPercent = (typeof ZOOM_PRESETS)[number];

export function isZoomPercent(value: unknown): value is ZoomPercent {
  return (
    typeof value === "number" &&
    ZOOM_PRESETS.some((preset) => preset === value)
  );
}
export type MessageRole = "user" | "assistant";

/**
 * One cited activity record, as it was when the answer was written.
 *
 * A copy rather than a pointer into the activity store, because activity is
 * subject to retention and the answer is not. A citation that resolved to
 * nothing six months later would be worse than no citation at all: the reader
 * would be shown a control that promises evidence and delivers a blank.
 *
 * These are the mentor's own cited ids joined to the records the mentor was
 * given. Nothing here is inferred, and an id the request cannot account for is
 * left out rather than guessed at.
 */
export interface Citation {
  id: string;
  /** Which adapter produced it, so the chip can show the right mark. */
  integrationId: string;
  /** The calendar date the activity happened, not when it was fetched. */
  occurredAt: string;
  summary: string;
  url: string | null;
}

/**
 * What one answer was built from, as the mentor reported it.
 *
 * The last three fields are optional because messages stored before they were
 * recorded do not carry them. A reader must treat "absent" as "not recorded",
 * never as "none": an empty list is a claim, and this application must not make
 * one on the mentor's behalf.
 */
export interface Grounding {
  goalIds: string[];
  principleIds: string[];
  sourceIds: string[];
  activityIds?: string[];
  /** See `Citation`. Absent on messages stored before citations were kept. */
  citations?: Citation[];
  observations?: string[];
  inferences?: string[];
  confidence: number;
  uncertainties: string[];
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  grounding?: Grounding;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface SendMessageInput {
  /** Correlates sender-scoped stream events with this request. */
  requestId: string;
  conversationId: string;
  content: string;
  provider: ProviderName;
}

export interface ChatStreamDelta {
  requestId: string;
  conversationId: string;
  content: string;
}

export interface DesktopApi {
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<Conversation>;
  createConversation(): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  sendMessage(input: SendMessageInput): Promise<Conversation>;
  onChatStream(listener: (delta: ChatStreamDelta) => void): () => void;

  readUserConfig(file: UserConfigFile): Promise<ConfigDocument>;
  writeUserConfig(file: UserConfigFile, data: unknown): Promise<ConfigDocument>;
  writeUserConfigText(
    file: UserConfigFile,
    text: string,
  ): Promise<ConfigDocument>;

  listMentors(): Promise<MentorSummary[]>;
  readMentorConfig(id: string, file: MentorConfigFile): Promise<ConfigDocument>;
  writeMentorConfig(
    id: string,
    file: MentorConfigFile,
    data: unknown,
  ): Promise<ConfigDocument>;
  writeMentorConfigText(
    id: string,
    file: MentorConfigFile,
    text: string,
  ): Promise<ConfigDocument>;
  duplicateMentor(
    sourceId: string,
    targetId: string,
    name: string,
  ): Promise<MentorSummary[]>;
  deleteMentor(id: string): Promise<MentorSummary[]>;

  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  setZoomPercent(percent: ZoomPercent): Promise<ZoomPercent>;

  listBriefings(): Promise<BriefingView[]>;
  runBriefingNow(): Promise<BriefingRunResult>;

  getStarterPrompts(): Promise<StarterPromptCacheView>;
  refreshStarterPrompts(): Promise<string[]>;

  /** Fires when a notification is clicked, so the pane can be opened. */
  onShowBriefing(handler: () => void): () => void;

  listIntegrations(): Promise<IntegrationsView>;
  refreshIntegration(id: string): Promise<IntegrationsView>;
  saveIntegrationPolicy(
    id: string,
    policy: IntegrationPolicyView,
  ): Promise<IntegrationsView>;
  setIntegrationsPaused(paused: boolean): Promise<IntegrationsView>;
  saveGitHubScope(scope: GitHubScopeView): Promise<IntegrationsView>;
  saveNotionScope(scope: NotionScopeView): Promise<IntegrationsView>;
  saveStravaScope(scope: StravaScopeView): Promise<IntegrationsView>;
  saveGoogleSheetsScope(
    scope: GoogleSheetsScopeView,
  ): Promise<IntegrationsView>;
  /**
   * Store a pasted service-account JSON key file.
   *
   * Takes the whole file rather than a PEM, because asking someone to extract a
   * multi-line key with escaped newlines out of JSON by hand is a support
   * round-trip. The private key goes to `SecretStore`; `client_email` goes to
   * integrations config so Settings can show what to share the sheet with.
   */
  saveGoogleServiceAccount(pastedJson: string): Promise<AuthorizeOutcome>;
  clearGoogleServiceAccount(): Promise<SecretStatus>;
  /**
   * Open Strava's consent page for the configured application.
   *
   * Exists because the token Strava shows on its own settings page carries
   * `read` scope and cannot list activities, so the obvious way to set this up
   * is the wrong one.
   */
  openStravaAuthorize(): Promise<AuthorizeOutcome>;
  /** Exchange the pasted redirect address for a refresh token and store it. */
  completeStravaAuthorize(pasted: string): Promise<AuthorizeOutcome>;
  /** Erases stored activity for one integration. There is no undo. */
  deleteIntegrationData(id: string): Promise<IntegrationsView>;

  /** Write-only. There is deliberately no getter for a credential. */
  getSecretStatus(): Promise<SecretStatus>;
  setOpenAiKey(value: string): Promise<SecretStatus>;
  clearOpenAiKey(): Promise<SecretStatus>;
  setGithubToken(value: string): Promise<SecretStatus>;
  clearGithubToken(): Promise<SecretStatus>;
  setGithubActivityToken(value: string): Promise<SecretStatus>;
  clearGithubActivityToken(): Promise<SecretStatus>;
  setNotionToken(value: string): Promise<SecretStatus>;
  clearNotionToken(): Promise<SecretStatus>;
  setStravaClientSecret(value: string): Promise<SecretStatus>;
  clearStravaClientSecret(): Promise<SecretStatus>;
  setStravaRefreshToken(value: string): Promise<SecretStatus>;
  clearStravaRefreshToken(): Promise<SecretStatus>;
  startSignIn(): Promise<LoginPrompt>;
  waitForSignIn(): Promise<LoginResult>;
  cancelSignIn(): Promise<LoginResult>;
  getAuthStatus(): Promise<CopilotAuthStatus>;
}

export type UserConfigFile =
  | "goals"
  | "values"
  | "current_state"
  | "constraints"
  | "communication";

export type MentorConfigFile = "profile" | "principles" | "sources" | "voice";

/**
 * A config file as the editor sees it: the parsed value drives the form, the
 * raw text drives the YAML tab. Both come from the same read so they cannot
 * disagree.
 */
export interface ConfigDocument {
  file: string;
  text: string;
  data: unknown;
  /** Set when the file on disk fails validation, so the form can step aside. */
  problem?: string;
  /** True only for an optional file that has not been created yet. */
  missing?: boolean;
}

export interface MentorSummary {
  id: string;
  name: string;
  description: string;
  domains: string[];
  fictional: boolean;
  disclaimer: string;
  loadable: boolean;
  problem?: string;
}

export interface AppSettings {
  provider: ProviderName;
  model: string;
  /**
   * What Today calls you. Empty is a legitimate answer — the greeting drops the
   * name rather than inventing one.
   */
  displayName: string;
  activeMentorId: string;
  briefingEnabled: boolean;
  /** Minutes since local midnight; 720 is noon. */
  briefingMinute: number;
  briefingHeadlineInNotification: boolean;
  /** Page zoom percentage. 100 is the default for older settings files. */
  zoomPercent: ZoomPercent;
}

/**
 * One day's briefing as the renderer sees it.
 *
 * Restated here rather than imported: the renderer must not reach into the
 * engine. `briefing` is null when the run failed, and `error` says why.
 */
export interface BriefingView {
  date: string;
  generatedAt: string;
  briefing: {
    headline: string;
    body: string;
    on_track: "yes" | "partly" | "no" | "unclear";
    priorities: string[];
    watch_out: string;
    goal_ids: string[];
    principle_ids: string[];
    source_ids: string[];
    activity_ids: string[];
    /**
     * What the mentor read, and what it concluded from it. Two fields rather
     * than one narrative ([HC-OBSERVATION-VS-INFERENCE]) — the user has to be
     * able to reject the reasoning without doubting the reading.
     */
    observations: string[];
    inferences: string[];
    confidence: number;
    uncertainties: string[];
  } | null;
  error: string | null;
  staleSources: string[];
  notified: boolean;
}

export interface BriefingRunResult {
  status: "completed" | "failed" | "skipped";
  reason: string;
  record: BriefingView | null;
}

/**
 * A personalized starter question as the renderer sees it.
 *
 * Restated here rather than imported: the renderer must not reach into the
 * engine.
 */
export interface StarterPromptCacheView {
  prompts: string[] | null;
  fresh: boolean;
}

/**
 * What Settings may know about a credential: whether one exists, and whether
 * the OS can encrypt it. Never the value itself ([HC-SECRETS-ENV-ONLY]).
 */
/** What the renderer shows while an OAuth device flow is pending. */
export interface LoginPrompt {
  verificationUri: string;
  userCode: string;
}

export interface LoginResult {
  ok: boolean;
  problem?: string;
}

/** Answered by the runtime, never by a flag this application stored. */
export interface CopilotAuthStatus {
  isAuthenticated: boolean;
  login?: string;
}

export interface SecretStatus {
  hasOpenAiKey: boolean;
  hasGithubToken: boolean;
  /** Read-only repository access. Distinct from the model's credential. */
  hasGithubActivityToken: boolean;
  hasNotionToken: boolean;
  hasStravaClientSecret: boolean;
  /**
   * Rotates. Unlike every other credential here the app may replace this one
   * itself, so "stored" can become true without the user typing anything.
   */
  hasStravaRefreshToken: boolean;
  /** The service account's private key, taken out of its pasted JSON file. */
  hasGoogleServiceAccountKey: boolean;
  encryptionAvailable: boolean;
}

/** Mirrors `integrationPolicySchema`, restated here so the renderer imports no engine code. */
export interface IntegrationPolicyView {
  enabled: boolean;
  sync: {
    on_app_load: boolean;
    on_demand: boolean;
    /** Zero disables the timer. */
    timer_minutes: number;
  };
  /** `start === end` means no quiet window. */
  quiet_hours: { start: number; end: number };
  retention_days: number;
}

/**
 * One integration as Settings sees it. `hosts` is shown to the user rather than
 * kept internal: the promise in `[HC-NO-EXFILTRATION]` is that the outbound
 * surface is declared, and a declaration nobody can read is not one.
 */
export interface IntegrationSummary {
  id: string;
  label: string;
  /** Every host this adapter may contact. Empty means it makes no call. */
  hosts: string[];
  requiresCredential: boolean;
  policy: IntegrationPolicyView;
  lastSyncedAt: string | null;
  lastError: string | null;
  signalCount: number;
  /** Present when the most recent refresh chose not to run, with the reason. */
  lastSkippedReason?: string;
}

/**
 * The GitHub adapter's scope, as Settings edits it.
 *
 * `domains` is the part that does the work: `ActivitySignal.domain` must equal a
 * `Goal.domain` for the mentor to connect a commit to a goal, and a repository
 * name almost never does.
 */
export interface GitHubScopeView {
  login: string;
  repositories: string[];
  organizations: string[];
  allRepositories: boolean;
  lookbackDays: number;
  domains: Record<string, string>;
}

/**
 * Which Notion database may be read, and how to interpret its columns.
 *
 * Every property name is here because no two task databases share a schema.
 * Notion has no canonical status or due-date column — they are whatever the
 * user named them — so these are settings rather than constants.
 */
export interface NotionScopeView {
  databaseId: string;
  /**
   * `rows` reads each database row as a task. `checkboxes` reads the to-do
   * blocks inside each row's page, which is how a daily journal is shaped.
   */
  taskSource: "rows" | "checkboxes";
  titleProperty: string;
  dateProperty: string;
  statusProperty: string;
  doneValues: string[];
  completedProperty: string;
  dueProperty: string;
  domainProperty: string;
  defaultDomain: string;
  includeOpenTasks: boolean;
  lookbackDays: number;
}

/**
 * Which Strava application may be used, and which goal its workouts serve.
 *
 * The client secret and refresh token are not here on purpose. Those are
 * credentials and live in `SecretStore`; this view crosses IPC to the renderer,
 * which must never receive one ([HC-SECRETS-ENV-ONLY]).
 */
/** Whether a setup step worked, and what to say if it did not. */
export interface AuthorizeOutcome {
  readonly ok: boolean;
  readonly problem: string | null;
}

export interface StravaScopeView {
  /** The API application's ID. Public — it appears in every authorize URL. */
  clientId: string;
  /** The goal domain every workout is filed under. */
  defaultDomain: string;
  lookbackDays: number;
}

/**
 * Which spreadsheet may be read, and how to interpret its columns.
 *
 * The private key is not here on purpose — it lives in `SecretStore`. The
 * service account's `clientEmail` is, because the user has to paste that
 * address into Google's share dialog by hand, and a value they cannot read
 * back is a setup step they cannot complete.
 */
export interface GoogleSheetsScopeView {
  /** A pasted `docs.google.com` URL is accepted; the adapter extracts the ID. */
  spreadsheetId: string;
  /** Empty means the first tab. */
  tabName: string;
  headerRow: number;
  /**
   * Not `headerRow + 1`. Training logs often carry an explanatory row under the
   * headers, and reading it as data produces one undated junk signal per sync.
   */
  firstDataRow: number;
  /** Shown, not editable in practice: it comes from the pasted key file. */
  clientEmail: string;
  dateColumn: string;
  /** What the coach prescribed. */
  plannedColumn: string;
  /** What was actually done. Empty means it was not. */
  actualColumn: string;
  /** Free-text columns appended to the summary. Off unless the user opts in. */
  noteColumns: string[];
  /**
   * Numeric column headers to keep, by name.
   *
   * A list rather than the stored header-to-key map. The key is mechanical —
   * "Running Miles" can only reasonably become `running_miles` — so the main
   * process derives it. Asking for it here would be a second field whose only
   * correct answer is a transformation of the first, and would put the
   * derivation in the renderer, which is not allowed to hold engine code.
   */
  metricColumns: string[];
  defaultDomain: string;
  lookbackDays: number;
}

export interface IntegrationsView {
  paused: boolean;
  integrations: IntegrationSummary[];
  /** False when the OS cannot encrypt, which blocks storing activity at all. */
  encryptionAvailable: boolean;
  github: GitHubScopeView;
  notion: NotionScopeView;
  strava: StravaScopeView;
  googleSheets: GoogleSheetsScopeView;
  /** Goal domains the user actually has, so the UI can offer real targets. */
  goalDomains: string[];
}
