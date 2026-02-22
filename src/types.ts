export interface TranscriptSegment {
  text: string;
  start: number; // seconds
  duration: number;
}

export interface EmbeddedSegment extends TranscriptSegment {
  embedding: number[];
  index: number;
}

export interface SearchResult {
  segment: TranscriptSegment;
  index: number;
  score: number; // 0–1, higher = more relevant
  matchType: "exact" | "semantic";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

export interface Citation {
  text: string;
  startSeconds: number;
  segmentIndex: number;
}

export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "mistral"
  | "groq"
  | "ollama";

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  models: ModelOption[];
  requiresKey: boolean;
  baseUrlOverride?: string; // for Ollama
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface Settings {
  apiKeys: Partial<Record<ProviderId, string>>;
  selectedProvider: ProviderId;
  selectedModel: string;
  ollamaBaseUrl: string;
  semanticSearchEnabled: boolean;
}

export type BackgroundMessage =
  | { type: "CHAT_STREAM"; payload: ChatStreamPayload }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; payload: Partial<Settings> };

export interface ChatStreamPayload {
  messages: { role: "user" | "assistant"; content: string }[];
  systemPrompt: string;
  provider: ProviderId;
  model: string;
  apiKey: string;
  ollamaBaseUrl?: string;
}
