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
  conversationId: string;
  content: string;
  provider: ProviderName;
}

export interface DesktopApi {
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<Conversation>;
  createConversation(): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  sendMessage(input: SendMessageInput): Promise<Conversation>;
}
