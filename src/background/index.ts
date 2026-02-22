/**
 * Background service worker.
 * Handles AI chat streaming (bypasses CORS from content scripts)
 * and settings persistence via chrome.storage.sync.
 */

import type { BackgroundMessage, Settings } from "../types";
import { DEFAULT_SETTINGS } from "../lib/providers";

chrome.runtime.onMessage.addListener(
  (message: BackgroundMessage, _sender, sendResponse) => {
    if (message.type === "GET_SETTINGS") {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
        sendResponse(settings);
      });
      return true; // async
    }

    if (message.type === "SAVE_SETTINGS") {
      chrome.storage.sync.set(message.payload, () => {
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "CHAT_STREAM") {
      handleChatStream(message.payload, sendResponse);
      return true;
    }
  }
);

async function handleChatStream(
  payload: Extract<BackgroundMessage, { type: "CHAT_STREAM" }>["payload"],
  sendResponse: (response: unknown) => void
) {
  const { messages, systemPrompt, provider, model, apiKey, ollamaBaseUrl } =
    payload;

  try {
    const { streamText } = await import("ai");
    let providerInstance: ReturnType<typeof import("@ai-sdk/anthropic").createAnthropic> |
      ReturnType<typeof import("@ai-sdk/openai").createOpenAI> |
      ReturnType<typeof import("@ai-sdk/google").createGoogleGenerativeAI> |
      ReturnType<typeof import("@ai-sdk/groq").createGroq> |
      ReturnType<typeof import("@ai-sdk/mistral").createMistral> |
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any;

    switch (provider) {
      case "anthropic": {
        const { createAnthropic } = await import("@ai-sdk/anthropic");
        providerInstance = createAnthropic({ apiKey });
        break;
      }
      case "openai": {
        const { createOpenAI } = await import("@ai-sdk/openai");
        providerInstance = createOpenAI({ apiKey });
        break;
      }
      case "google": {
        const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
        providerInstance = createGoogleGenerativeAI({ apiKey });
        break;
      }
      case "groq": {
        const { createGroq } = await import("@ai-sdk/groq");
        providerInstance = createGroq({ apiKey });
        break;
      }
      case "mistral": {
        const { createMistral } = await import("@ai-sdk/mistral");
        providerInstance = createMistral({ apiKey });
        break;
      }
      case "ollama": {
        const { createOllama } = await import("ollama-ai-provider");
        providerInstance = createOllama({ baseURL: ollamaBaseUrl + "/api" });
        break;
      }
      default:
        sendResponse({ error: `Unknown provider: ${provider}` });
        return;
    }

    const result = await streamText({
      model: providerInstance(model),
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    let fullText = "";
    for await (const chunk of result.textStream) {
      fullText += chunk;
      // Stream chunks back via runtime messages to the content script
      chrome.runtime.sendMessage({
        type: "CHAT_CHUNK",
        payload: { chunk, fullText },
      }).catch(() => {/* content script may not be listening yet */});
    }

    sendResponse({ ok: true, fullText });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendResponse({ error: message });
  }
}

export {};
