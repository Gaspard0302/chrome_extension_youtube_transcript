/**
 * Background service worker.
 * Handles AI chat streaming (bypasses CORS from content scripts)
 * and settings persistence via chrome.storage.sync.
 */

import type { BackgroundMessage, ChatStreamPayload, Settings, TimelinePayload } from "../types";
import { DEFAULT_SETTINGS } from "../lib/providers";
import { streamText, generateText, jsonSchema, tool } from "ai";
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

    if (message.type === "GENERATE_TIMELINE") {
      handleGenerateTimeline(message.payload, sendResponse);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProviderInstance(
  provider: string,
  apiKey: string,
  ollamaBaseUrl?: string
): unknown {
  switch (provider) {
    case "anthropic": return createAnthropic({ apiKey });
    case "openai": return createOpenAI({ apiKey });
    case "google": return createGoogleGenerativeAI({ apiKey });
    case "groq": return createGroq({ apiKey });
    case "mistral": return createMistral({ apiKey });
    case "ollama": return createOllama({ baseURL: (ollamaBaseUrl ?? "http://localhost:11434") + "/api" });
    default: return null;
  }
}

/**
 * Agentic RAG chat: the model can call search_transcript up to 3 times
 * (maxSteps=4 = 3 tool calls + 1 final text generation).
 * Each tool call is forwarded to the content script via tabs.sendMessage.
 * Text chunks stream to the content script via CHAT_CHUNK.
 */
async function handleChatStream(
  payload: ChatStreamPayload & { tabId?: number },
  sendResponse: (response: unknown) => void
) {
  const { messages, systemPrompt, provider, model, apiKey, ollamaBaseUrl, tabId } = payload;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const providerInstance = buildProviderInstance(provider, apiKey, ollamaBaseUrl) as any;
    if (!providerInstance) {
      sendResponse({ error: `Unknown provider: ${provider}` });
      return;
    }

    // Tool: search the transcript (executed by content script which holds the segments)
    const searchTranscriptTool = tool({
      description:
        "Search the video transcript for segments relevant to a query. " +
        "Returns up to 15 matching transcript snippets with timestamps. " +
        "Use up to 3 times with different queries to gather all necessary context.",
      parameters: jsonSchema<{ query: string }>({
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to find relevant transcript segments",
          },
        },
        required: ["query"],
      }),
      execute: async ({ query }: { query: string }): Promise<string> => {
        if (tabId == null) return "Search unavailable (no tab context).";
        return new Promise<string>((resolve) => {
          chrome.tabs.sendMessage(
            tabId,
            { type: "SEARCH_REQUEST", payload: { query } },
            (response: { results: string } | undefined) => {
              if (chrome.runtime.lastError || !response) {
                resolve("No results found for this query.");
              } else {
                resolve(response.results);
              }
            }
          );
        });
      },
    });

    const result = await streamText({
      model: providerInstance(model),
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      tools: { search_transcript: searchTranscriptTool },
      maxSteps: 4, // up to 3 tool calls + 1 final text step
    });

    let fullText = "";
    for await (const part of result.fullStream) {
      if (
        part.type === "tool-call" &&
        part.toolName === "search_transcript" &&
        tabId != null
      ) {
        // Notify UI that a search is in progress
        chrome.tabs
          .sendMessage(tabId, {
            type: "CHAT_SEARCHING",
            payload: { query: (part.args as { query: string }).query },
          })
          .catch(() => {});
      } else if (part.type === "text-delta") {
        fullText += part.textDelta;
        if (tabId != null) {
          chrome.tabs
            .sendMessage(tabId, {
              type: "CHAT_CHUNK",
              payload: { chunk: part.textDelta, fullText },
            })
            .catch(() => {});
        }
      }
    }

    sendResponse({ ok: true, fullText });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendResponse({ error: message });
  }
}

// ---------------------------------------------------------------------------
// Timeline generation — batch-generate short titles for video segments.
// ---------------------------------------------------------------------------

function fmtTs(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function handleGenerateTimeline(
  payload: TimelinePayload,
  sendResponse: (r: unknown) => void
) {
  const { blocks, provider, model, apiKey, ollamaBaseUrl } = payload;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const providerInstance = buildProviderInstance(provider, apiKey, ollamaBaseUrl) as any;
    if (!providerInstance) {
      sendResponse({ error: `Unknown provider: ${provider}` });
      return;
    }

    const blockDescriptions = blocks
      .map(
        (b, i) =>
          `Block ${i + 1} [${fmtTs(b.startTime)} – ${fmtTs(b.endTime)}]:\n${b.text}`
      )
      .join("\n\n");

    const result = await generateText({
      model: providerInstance(model),
      system:
        "You are analyzing a YouTube video transcript. " +
        "For each given segment, provide a short, descriptive title (4–7 words) capturing the main topic. " +
        "Return ONLY a valid JSON array of strings, one per segment, in order. No other text, no markdown fences.",
      messages: [
        {
          role: "user",
          content: `Generate titles for these ${blocks.length} video segments:\n\n${blockDescriptions}`,
        },
      ],
    });

    let titles: string[];
    try {
      titles = JSON.parse(result.text.trim());
    } catch {
      // Try to extract an array embedded in the text
      const m = result.text.match(/\[[\s\S]+\]/);
      try {
        titles = m ? JSON.parse(m[0]) : [];
      } catch {
        titles = [];
      }
    }

    // Ensure correct length
    while (titles.length < blocks.length)
      titles.push(`Segment ${titles.length + 1}`);
    titles = titles.slice(0, blocks.length);

    sendResponse({ titles });
  } catch (err) {
    sendResponse({
      error: err instanceof Error ? err.message : String(err),
    });
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
