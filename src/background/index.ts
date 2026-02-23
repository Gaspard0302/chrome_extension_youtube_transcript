/**
 * Background service worker.
 * Handles AI chat streaming (bypasses CORS from content scripts)
 * and settings persistence via chrome.storage.sync.
 */

import type { BackgroundMessage, ChatStreamPayload, Settings } from "../types";
import { DEFAULT_SETTINGS } from "../lib/providers";
import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOllama } from "ollama-ai-provider";

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
      const tabId = _sender.tab?.id;
      handleChatStream({ ...message.payload, tabId }, sendResponse);
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
  // No API key in the URL: the key parameter has been rate-limited/blocked.
  // Android User-Agent is required; YouTube returns 403 without it.
  try {
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/player?prettyPrint=false`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
          'X-YouTube-Client-Name': '3',
          'X-YouTube-Client-Version': '19.09.37',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '19.09.37',
              androidSdkVersion: 30,
              hl: 'en',
              gl: 'US',
            },
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

/**
 * Run streamText directly in the service worker and broadcast each chunk via
 * chrome.runtime.sendMessage so all content scripts receive CHAT_CHUNK.
 */
async function handleChatStream(
  payload: ChatStreamPayload & { tabId?: number },
  sendResponse: (response: unknown) => void
) {
  const { messages, systemPrompt, provider, model, apiKey, ollamaBaseUrl, tabId } = payload;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let providerInstance: any;
    switch (provider) {
      case "anthropic":
        providerInstance = createAnthropic({ apiKey });
        break;
      case "openai":
        providerInstance = createOpenAI({ apiKey });
        break;
      case "google":
        providerInstance = createGoogleGenerativeAI({ apiKey });
        break;
      case "groq":
        providerInstance = createGroq({ apiKey });
        break;
      case "mistral":
        providerInstance = createMistral({ apiKey });
        break;
      case "ollama":
        providerInstance = createOllama({
          baseURL: (ollamaBaseUrl ?? "http://localhost:11434") + "/api",
        });
        break;
      default:
        sendResponse({ error: `Unknown provider: ${provider}` });
        return;
    }

    const result = await streamText({
      model: providerInstance(model),
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    let fullText = "";
    for await (const chunk of result.textStream) {
      fullText += chunk;
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, {
          type: "CHAT_CHUNK",
          payload: { chunk, fullText },
        }).catch(() => {});
      }
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
