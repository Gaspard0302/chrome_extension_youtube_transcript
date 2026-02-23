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

    if (message.type === "GET_CAPTION_TRACKS") {
      handleGetCaptionTracks(message.payload.videoId, sendResponse);
      return true;
    }

    if (message.type === "FETCH_TRANSCRIPT_URL") {
      handleFetchTranscriptUrl(message.payload.url, sendResponse);
      return true;
    }

    if (message.type === "EMBED_TEXT") {
      handleEmbedText(message.payload.text, sendResponse);
      return true;
    }
  }
);

type CaptionTrack = {
  baseUrl: string;
  name: { simpleText: string };
  languageCode: string;
  kind?: string;
};

async function handleGetCaptionTracks(
  videoId: string,
  sendResponse: (r: unknown) => void
) {
  // Use Innertube ANDROID client — returns baseUrl values without exp=xpe,
  // so no Proof-of-Origin Token is required.
  const apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  try {
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            client: { clientName: 'ANDROID', clientVersion: '20.10.38' },
          },
          videoId,
        }),
      }
    );
    if (!res.ok) {
      sendResponse({ error: `Innertube player returned ${res.status}` });
      return;
    }
    const data = await res.json();
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    sendResponse({ tracks: Array.isArray(tracks) ? tracks : [] });
  } catch (err) {
    sendResponse({ error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Fetch a transcript timedtext URL through the background worker.
 * Content scripts can't reliably fetch these due to missing cookies / CORS.
 * The background worker has full network access and shares the browser's cookies.
 */
async function handleFetchTranscriptUrl(
  url: string,
  sendResponse: (r: unknown) => void
) {
  try {
    const res = await fetch(url, {
      headers: { "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!res.ok) {
      sendResponse({ error: `HTTP ${res.status}` });
      return;
    }
    const text = await res.text();
    sendResponse({ text });
  } catch (err) {
    sendResponse({ error: err instanceof Error ? err.message : String(err) });
  }
}

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
      }).catch(() => {/* content script may not be listening yet */ });
    }

    sendResponse({ ok: true, fullText });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendResponse({ error: message });
  }
}

// ---------------------------------------------------------------------------
// Embedding — delegates to the offscreen document.
// Service workers cannot use dynamic import() at runtime (HTML spec), so the
// actual pipeline lives in an offscreen document (a real extension page with
// window + full import() support). The background creates it on demand and
// forwards EMBED_TEXT as OFFSCREEN_EMBED_TEXT.
// ---------------------------------------------------------------------------

const OFFSCREEN_URL = chrome.runtime.getURL("src/offscreen/index.html");

async function ensureOffscreenDocument() {
  // getContexts is the MV3 way to check if the offscreen doc already exists.
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
    documentUrls: [OFFSCREEN_URL],
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reasons: ["BLOBS" as any],
      justification: "Run ML embedding inference (WASM/ORT) outside service worker",
    });
  }
}

async function handleEmbedText(
  text: string,
  sendResponse: (r: unknown) => void
) {
  try {
    await ensureOffscreenDocument();
    chrome.runtime.sendMessage(
      { type: "OFFSCREEN_EMBED_TEXT", payload: { text } },
      (response: unknown) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      }
    );
  } catch (err) {
    sendResponse({ error: err instanceof Error ? err.message : String(err) });
  }
}

export { };
