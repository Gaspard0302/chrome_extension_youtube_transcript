import React, { useState, useRef, useEffect } from "react";
import type { ChatMessage, Settings, TranscriptSegment } from "../../types";
import { formatTimestamp } from "../../lib/transcript";
import { PROVIDERS } from "../../lib/providers";

interface Props {
  segments: TranscriptSegment[];
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

export default function ChatTab({
  segments,
  settings,
  onSettingsChange,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const streamingTextRef = useRef("");

  const availableProviders = PROVIDERS.filter(
    (p) => !p.requiresKey || (settings.apiKeys[p.id] ?? "").length > 0
  );
  const hasAnyProvider = availableProviders.length > 0;
  const effectiveProvider =
    availableProviders.find((p) => p.id === settings.selectedProvider) ??
    availableProviders[0] ?? null;

  const provider = PROVIDERS.find((p) => p.id === settings.selectedProvider);
  const apiKey = settings.apiKeys[settings.selectedProvider] ?? "";
  const hasKey = !provider?.requiresKey || apiKey.length > 0;
  const hasModel = !!settings.selectedModel;

  useEffect(() => {
    if (!settings.selectedModel && availableProviders.length > 0) {
      const p = availableProviders[0];
      onSettingsChange({ ...settings, selectedProvider: p.id, selectedModel: p.models[0].id });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableProviders.length, settings.selectedModel]);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  function buildSystemPrompt(): string {
    const fullTranscript = segments
      .map((s) => `[${formatTimestamp(s.start)}] ${s.text}`)
      .join("\n");

    return `You are a helpful assistant answering questions about a YouTube video. You have full access to the transcript below — use it as the single source of truth.

When you reference anything from the video (a quote, a claim, an explanation), you MUST cite the exact timestamp so the user can click it and jump the video to that moment. Use this format only: [MM:SS] for times under an hour (e.g. [5:42]) or [H:MM:SS] for longer (e.g. [1:23:45]). The user's player will make these clickable.

FULL TRANSCRIPT (each line is [timestamp] text):
${fullTranscript}

Rules:
- Answer only from the transcript content above.
- For every specific reference to the video, include a timestamp in [MM:SS] or [H:MM:SS] so the user can click to seek.
- If the video doesn't cover the topic, say so clearly.
- Be concise and direct.`;
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setError("");
    streamingTextRef.current = "";

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const chunkListener = (msg: {
      type: string;
      payload: { chunk: string; fullText: string };
    }) => {
      if (msg.type === "CHAT_CHUNK") {
        streamingTextRef.current = msg.payload.fullText;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: streamingTextRef.current,
          };
          return updated;
        });
      }
    };

    chrome.runtime.onMessage.addListener(chunkListener);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "CHAT_STREAM",
        payload: {
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          systemPrompt: buildSystemPrompt(),
          provider: settings.selectedProvider,
          model: settings.selectedModel,
          apiKey,
          ollamaBaseUrl: settings.ollamaBaseUrl,
        },
      });

      if (response?.error) {
        setError(response.error);
        setMessages((prev) => prev.slice(0, -1));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      chrome.runtime.onMessage.removeListener(chunkListener);
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function jumpTo(seconds: number) {
    const video = document.querySelector<HTMLVideoElement>("video");
    if (video) {
      video.currentTime = seconds;
      video.play();
    }
  }

  /** Parse [MM:SS], [H:MM:SS], (MM:SS), (H:MM:SS) into seconds for click-to-seek. */
  function parseTimestampToSeconds(part: string): number | null {
    const bracketMatch = part.match(/^\[(\d+):(\d{2})(?::(\d{2}))?\]$/);
    const parenMatch = part.match(/^\((\d+):(\d{2})(?::(\d{2}))?\)$/);
    const match = bracketMatch ?? parenMatch;
    if (!match) return null;
    const h = match[3] !== undefined ? parseInt(match[1], 10) : 0;
    const m =
      match[3] !== undefined ? parseInt(match[2], 10) : parseInt(match[1], 10);
    const s =
      match[3] !== undefined ? parseInt(match[3], 10) : parseInt(match[2], 10);
    return h * 3600 + m * 60 + s;
  }

  function renderMessageContent(content: string) {
    // Match [MM:SS], [H:MM:SS], (MM:SS), (H:MM:SS) so timestamps are clickable
    const timestampRe = /(\[\d+:\d{2}(?::\d{2})?\]|\(\d+:\d{2}(?::\d{2})?\))/g;
    const parts = content.split(timestampRe);
    return parts.map((part, i) => {
      const seconds = parseTimestampToSeconds(part);
      if (seconds !== null) {
        return (
          <button
            key={i}
            type="button"
            onClick={() => jumpTo(seconds)}
            style={{
              background:
                "var(--yt-spec-general-background-a, rgba(0,0,0,0.4))",
              border:
                "1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.15))",
              borderRadius: 4,
              color: "var(--yt-spec-call-to-action-inverse-color, #ff0000)",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              padding: "1px 6px",
              margin: "0 2px",
              fontFamily: "inherit",
            }}
          >
            {part}
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Live Chat-style compact header with model selectors */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom:
            "1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1))",
          display: "flex",
          gap: 6,
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        {!hasAnyProvider ? (
          <span style={{ fontSize: 12, color: "#fbbf24" }}>
            No API provider configured. Add an API key in the extension settings.
          </span>
        ) : (
          <>
            <select
              value={effectiveProvider?.id ?? ""}
              onChange={(e) => {
                const p = availableProviders.find((pr) => pr.id === e.target.value)!;
                onSettingsChange({
                  ...settings,
                  selectedProvider: p.id,
                  selectedModel: p.models[0].id,
                });
              }}
              style={selectStyle}
            >
              {availableProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              value={settings.selectedModel}
              onChange={(e) =>
                onSettingsChange({ ...settings, selectedModel: e.target.value })
              }
              style={selectStyle}
            >
              {(effectiveProvider?.models ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {!hasKey && (
        <div
          style={{
            margin: "8px 12px",
            padding: "8px 10px",
            background: "rgba(42,26,0,0.8)",
            border: "1px solid rgba(124,74,0,0.8)",
            borderRadius: 6,
            fontSize: 12,
            color: "#fbbf24",
            flexShrink: 0,
          }}
        >
          No API key set for {provider?.label}. Add one in the extension
          settings.
        </div>
      )}

      {hasKey && !hasModel && (
        <div
          style={{
            margin: "8px 12px",
            padding: "8px 10px",
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--yt-spec-text-secondary, #aaa)",
            flexShrink: 0,
          }}
        >
          Select a model in the extension settings to use AI Chat.
        </div>
      )}

      {/* Scrollable message list — Live Chat style */}
      <div
        ref={messagesContainerRef}
        className="yt-transcript-scrollable"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "var(--yt-spec-text-secondary, #aaa)",
              fontSize: 13,
              marginTop: 16,
              lineHeight: 1.7,
            }}
          >
            Ask anything about this video.
            <br />
            <span style={{ fontSize: 11 }}>
              Timestamps in answers are clickable.
            </span>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "88%",
                padding: "9px 12px",
                borderRadius:
                  msg.role === "user"
                    ? "12px 12px 2px 12px"
                    : "12px 12px 12px 2px",
                background:
                  msg.role === "user"
                    ? "var(--yt-spec-call-to-action-inverse-color, #cc0000)"
                    : "var(--yt-spec-general-background-a, rgba(0,0,0,0.4))",
                fontSize: 13,
                lineHeight: 1.6,
                color: "var(--yt-spec-text-primary, #f1f1f1)",
              }}
            >
              {msg.role === "assistant"
                ? renderMessageContent(msg.content)
                : msg.content}
              {loading &&
                i === messages.length - 1 &&
                msg.role === "assistant" &&
                !msg.content && (
                  <span
                    style={{
                      color: "var(--yt-spec-text-secondary, #aaa)",
                    }}
                  >
                    ▋
                  </span>
                )}
            </div>
          </div>
        ))}

        {error && (
          <div
            style={{ color: "#f87171", fontSize: 12, padding: "4px 0" }}
          >
            Error: {error}
          </div>
        )}
      </div>

      {/* Sticky input at the bottom — Live Chat style */}
      <div
        style={{
          padding: "10px 12px",
          borderTop:
            "1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1))",
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
          flexShrink: 0,
          background: "var(--yt-spec-brand-background-solid, #212121)",
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about the video… (Enter to send)"
          disabled={loading || !hasKey || !hasModel || !hasAnyProvider}
          rows={1}
          style={{
            flex: 1,
            background:
              "var(--yt-spec-general-background-a, rgba(0,0,0,0.3))",
            border:
              "1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.15))",
            borderRadius: 20,
            padding: "9px 14px",
            color: "var(--yt-spec-text-primary, #f1f1f1)",
            fontSize: 13,
            resize: "none",
            outline: "none",
            fontFamily: "inherit",
            lineHeight: 1.5,
            maxHeight: 100,
            overflow: "auto",
            boxSizing: "border-box",
          }}
          onFocus={(e) =>
            (e.target.style.borderColor =
              "var(--yt-spec-call-to-action-inverse-color, #ff0000)")
          }
          onBlur={(e) =>
            (e.target.style.borderColor =
              "var(--yt-spec-10-percent-layer, rgba(255,255,255,0.15))")
          }
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim() || !hasKey || !hasModel || !hasAnyProvider}
          style={{
            background:
              loading || !input.trim() || !hasKey || !hasModel || !hasAnyProvider
                ? "var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1))"
                : "var(--yt-spec-call-to-action-inverse-color, #ff0000)",
            border: "none",
            borderRadius: "50%",
            color: "var(--yt-spec-static-brand-white, #fff)",
            cursor:
              loading || !input.trim() || !hasKey || !hasModel || !hasAnyProvider ? "default" : "pointer",
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            fontWeight: 700,
            transition: "background 0.15s",
            flexShrink: 0,
            fontFamily: "inherit",
          }}
        >
          {loading ? "…" : "↑"}
        </button>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: "var(--yt-spec-general-background-a, rgba(0,0,0,0.4))" as string,
  border:
    "1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.15))" as string,
  borderRadius: 16,
  color: "var(--yt-spec-text-primary, #f1f1f1)" as string,
  padding: "5px 10px",
  fontSize: 12,
  cursor: "pointer",
  flex: 1,
  outline: "none",
  fontFamily: "'Roboto', 'Arial', sans-serif",
};
