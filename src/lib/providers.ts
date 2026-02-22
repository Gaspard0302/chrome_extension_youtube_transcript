import type { ProviderConfig } from "../types";

export const PROVIDERS: ProviderConfig[] = [
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    requiresKey: true,
    models: [
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    requiresKey: true,
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
      { id: "o3-mini", label: "o3-mini" },
    ],
  },
  {
    id: "google",
    label: "Google Gemini",
    requiresKey: true,
    models: [
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    ],
  },
  {
    id: "groq",
    label: "Groq (fast)",
    requiresKey: true,
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" },
      { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    requiresKey: true,
    models: [
      { id: "mistral-large-latest", label: "Mistral Large" },
      { id: "mistral-small-latest", label: "Mistral Small" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    requiresKey: false,
    baseUrlOverride: "http://localhost:11434",
    models: [
      { id: "llama3.2", label: "Llama 3.2" },
      { id: "mistral", label: "Mistral" },
      { id: "qwen2.5", label: "Qwen 2.5" },
    ],
  },
];

export const DEFAULT_SETTINGS = {
  apiKeys: {},
  selectedProvider: "anthropic" as const,
  selectedModel: "claude-sonnet-4-6",
  ollamaBaseUrl: "http://localhost:11434",
  semanticSearchEnabled: true,
};

export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
