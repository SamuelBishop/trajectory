export type ProviderName = "deterministic" | "copilot" | "openai";
export type MessageRole = "user" | "assistant";

export interface Grounding {
  goalIds: string[];
  principleIds: string[];
  sourceIds: string[];
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

  /** Write-only. There is deliberately no getter for a credential. */
  getSecretStatus(): Promise<SecretStatus>;
  setOpenAiKey(value: string): Promise<SecretStatus>;
  clearOpenAiKey(): Promise<SecretStatus>;
  setGithubToken(value: string): Promise<SecretStatus>;
  clearGithubToken(): Promise<SecretStatus>;
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
  activeMentorId: string;
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
  encryptionAvailable: boolean;
}
