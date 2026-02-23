import React, { useState, useRef, useEffect } from "react";
import type { ChatMessage, Settings, TranscriptSegment } from "../../types";
import { PROVIDERS } from "../../lib/providers";

interface Props {
  segments: TranscriptSegment[];
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
  videoId: string | null;
}

// ---------------------------------------------------------------------------
// Markdown + timestamp renderer
// ---------------------------------------------------------------------------

function parseTimestampToSeconds(part: string): number | null {
  const m = part.match(/^\[(\d+):(\d{2})(?::(\d{2}))?\]$/);
  if (!m) return null;
  const h = m[3] !== undefined ? parseInt(m[1], 10) : 0;
  const min =
    m[3] !== undefined ? parseInt(m[2], 10) : parseInt(m[1], 10);
  const sec =
    m[3] !== undefined ? parseInt(m[3], 10) : parseInt(m[2], 10);
  return h * 3600 + min * 60 + sec;
}

function parseInline(
  text: string,
  jumpTo: (s: number) => void,
  keyPrefix: string
): React.ReactNode[] {
  // Combined regex: timestamps, bold, italic, inline code
  const re =
    /(\[\d+:\d{2}(?::\d{2})?\]|\*\*(?:[^*]|\*(?!\*))+?\*\*|\*[^*\n]+?\*|`[^`\n]+`)/g;
  const parts = text.split(re);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    const secs = parseTimestampToSeconds(part);
    if (secs !== null) {
      return (
        <button
          key={key}
          type="button"
          onClick={() => jumpTo(secs)}
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
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          style={{
            background: "rgba(0,0,0,0.35)",
            borderRadius: 3,
            padding: "1px 5px",
            fontSize: "0.88em",
            fontFamily: "monospace",
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

function renderMarkdown(
  content: string,
  jumpTo: (s: number) => void
): React.ReactNode {
  // Phase 1: split out fenced code blocks
  type Segment =
    | { t: "code"; lang: string; code: string }
    | { t: "text"; text: string };
  const segments: Segment[] = [];
  const codeRe = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIdx = 0;
  let cm: RegExpExecArray | null;
  while ((cm = codeRe.exec(content)) !== null) {
    if (cm.index > lastIdx)
      segments.push({ t: "text", text: content.slice(lastIdx, cm.index) });
    segments.push({ t: "code", lang: cm[1] || "", code: cm[2].replace(/\n$/, "") });
    lastIdx = cm.index + cm[0].length;
  }
  if (lastIdx < content.length)
    segments.push({ t: "text", text: content.slice(lastIdx) });

  return (
    <div style={{ lineHeight: 1.65 }}>
      {segments.map((seg, si) => {
        if (seg.t === "code") {
          return (
            <pre
              key={si}
              style={{
                background: "rgba(0,0,0,0.45)",
                borderRadius: 6,
                padding: "8px 10px",
                overflowX: "auto",
                fontSize: 12,
                margin: "6px 0",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              <code>{seg.code}</code>
            </pre>
          );
        }

        // Phase 2: process line-by-line
        const lines = seg.text.split("\n");
        const nodes: React.ReactNode[] = [];
        let i = 0;
        while (i < lines.length) {
          const line = lines[i];
          if (!line.trim()) {
            i++;
            continue;
          }

          // Headings
          const hm = line.match(/^(#{1,3}) (.+)/);
          if (hm) {
            const level = hm[1].length;
            nodes.push(
              <div
                key={`${si}-h-${i}`}
                style={{
                  fontWeight: 700,
                  fontSize: level === 1 ? 15 : 14,
                  margin: "8px 0 3px",
                  color: "var(--yt-spec-text-primary, #f1f1f1)",
                }}
              >
                {parseInline(hm[2], jumpTo, `${si}-h-${i}`)}
              </div>
            );
            i++;
            continue;
          }

          // Unordered list
          if (/^[-*+] /.test(line)) {
            const items: React.ReactNode[] = [];
            while (i < lines.length && /^[-*+] /.test(lines[i])) {
              items.push(
                <li key={i} style={{ marginBottom: 2 }}>
                  {parseInline(lines[i].slice(2), jumpTo, `${si}-li-${i}`)}
                </li>
              );
              i++;
            }
            nodes.push(
              <ul
                key={`${si}-ul-${i}`}
                style={{ paddingLeft: 18, margin: "3px 0" }}
              >
                {items}
              </ul>
            );
            continue;
          }

          // Ordered list
          if (/^\d+\. /.test(line)) {
            const items: React.ReactNode[] = [];
            while (i < lines.length && /^\d+\. /.test(lines[i])) {
              items.push(
                <li key={i} style={{ marginBottom: 2 }}>
                  {parseInline(
                    lines[i].replace(/^\d+\. /, ""),
                    jumpTo,
                    `${si}-oli-${i}`
                  )}
                </li>
              );
              i++;
            }
            nodes.push(
              <ol
                key={`${si}-ol-${i}`}
                style={{ paddingLeft: 18, margin: "3px 0" }}
              >
                {items}
              </ol>
            );
            continue;
          }

          // Blockquote
          if (line.startsWith("> ")) {
            nodes.push(
              <blockquote
                key={`${si}-bq-${i}`}
                style={{
                  borderLeft: "3px solid rgba(255,255,255,0.2)",
                  paddingLeft: 8,
                  margin: "4px 0",
                  color: "var(--yt-spec-text-secondary, #aaa)",
                  fontStyle: "italic",
                }}
              >
                {parseInline(line.slice(2), jumpTo, `${si}-bq-${i}`)}
              </blockquote>
            );
            i++;
            continue;
          }

          // Horizontal rule
          if (/^---+$/.test(line.trim())) {
            nodes.push(
              <hr
                key={`${si}-hr-${i}`}
                style={{
                  border: "none",
                  borderTop:
                    "1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1))",
                  margin: "8px 0",
                }}
              />
            );
            i++;
            continue;
          }

          // Regular paragraph line
          nodes.push(
            <p key={`${si}-p-${i}`} style={{ margin: "0 0 5px" }}>
              {parseInline(line, jumpTo, `${si}-p-${i}`)}
            </p>
          );
          i++;
        }
        return <React.Fragment key={si}>{nodes}</React.Fragment>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatTab component
// ---------------------------------------------------------------------------

export default function ChatTab({
  segments,
  settings,
  onSettingsChange,
  videoId,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchPhase, setSearchPhase] = useState<string | null>(null);
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
      onSettingsChange({
        ...settings,
        selectedProvider: p.id,
        selectedModel: p.models[0].id,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableProviders.length, settings.selectedModel]);

  // Hydrate from sessionStorage when videoId is available
  useEffect(() => {
    if (!videoId) return;
    try {
      const stored = sessionStorage.getItem(`yt-transcript-chat:${videoId}`);
      if (stored) setMessages(JSON.parse(stored));
    } catch {
      // ignore parse errors
    }
  }, [videoId]);

  // Persist messages to sessionStorage on every change
  useEffect(() => {
    if (!videoId) return;
    try {
      if (messages.length > 0) {
        sessionStorage.setItem(
          `yt-transcript-chat:${videoId}`,
          JSON.stringify(messages)
        );
      } else {
        sessionStorage.removeItem(`yt-transcript-chat:${videoId}`);
      }
    } catch {
      // ignore quota errors
    }
  }, [messages, videoId]);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, searchPhase]);

  function clearChat() {
    setMessages([]);
    if (videoId) sessionStorage.removeItem(`yt-transcript-chat:${videoId}`);
  }

  function buildSystemPrompt(): string {
    const totalDuration =
      segments.length > 0
        ? segments[segments.length - 1].start +
          (segments[segments.length - 1].duration || 0)
        : 0;
    const totalMins = Math.round(totalDuration / 60);

    return `You are a helpful assistant answering questions about a YouTube video based on its transcript.

You have access to a \`search_transcript\` tool that retrieves up to 15 relevant transcript segments for a given query.
ALWAYS use this tool to find relevant context before answering — never answer content questions from memory alone.
You may search up to 3 times using different queries to gather all necessary information.

Video info: ${segments.length} transcript segments, approximately ${totalMins} minutes long.

When referencing video content, ALWAYS cite the exact timestamp in [MM:SS] or [H:MM:SS] format — these render as clickable seek buttons in the UI.

Guidelines:
- Search first, answer second — always search before responding to content questions
- Use different search angles if one query isn't enough
- Include a timestamp for every specific claim, quote, or reference from the video
- Be concise and direct`;
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setError("");
    setSearchPhase(null);
    streamingTextRef.current = "";

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const chunkListener = (msg: {
      type: string;
      payload: { chunk?: string; fullText?: string; query?: string };
    }) => {
      if (msg.type === "CHAT_SEARCHING") {
        setSearchPhase(msg.payload.query ?? null);
        return;
      }
      if (msg.type === "CHAT_CHUNK") {
        setSearchPhase(null);
        streamingTextRef.current = msg.payload.fullText ?? "";
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
      setSearchPhase(null);
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Provider/model selector bar */}
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
            No API provider configured. Add an API key in the extension
            settings.
          </span>
        ) : (
          <>
            <select
              value={effectiveProvider?.id ?? ""}
              onChange={(e) => {
                const p = availableProviders.find(
                  (pr) => pr.id === e.target.value
                )!;
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
                onSettingsChange({
                  ...settings,
                  selectedModel: e.target.value,
                })
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
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearChat}
            title="Clear chat history"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--yt-spec-text-secondary, #aaa)",
              cursor: "pointer",
              padding: 4,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color =
                "var(--yt-spec-text-primary, #f1f1f1)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color =
                "var(--yt-spec-text-secondary, #aaa)")
            }
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            </svg>
          </button>
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

      {/* Message list */}
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
              The AI will search the transcript up to 3 times. Timestamps are
              clickable.
            </span>
          </div>
        )}

        {messages.map((msg, i) => {
          const isLastAssistant =
            loading && i === messages.length - 1 && msg.role === "assistant";
          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems:
                  msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "90%",
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
                {msg.role === "assistant" ? (
                  msg.content ? (
                    renderMarkdown(msg.content, jumpTo)
                  ) : isLastAssistant ? (
                    <span
                      style={{
                        color: "var(--yt-spec-text-secondary, #aaa)",
                        fontSize: 12,
                        fontStyle: "italic",
                      }}
                    >
                      {searchPhase
                        ? `Searching: "${searchPhase}"…`
                        : "▋"}
                    </span>
                  ) : null
                ) : (
                  msg.content
                )}
              </div>
            </div>
          );
        })}

        {error && (
          <div style={{ color: "#f87171", fontSize: 12, padding: "4px 0" }}>
            Error: {error}
          </div>
        )}
      </div>

      {/* Input bar */}
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
          disabled={
            loading ||
            !input.trim() ||
            !hasKey ||
            !hasModel ||
            !hasAnyProvider
          }
          style={{
            background:
              loading || !input.trim() || !hasKey || !hasModel || !hasAnyProvider
                ? "var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1))"
                : "var(--yt-spec-call-to-action-inverse-color, #ff0000)",
            border: "none",
            borderRadius: "50%",
            color: "var(--yt-spec-static-brand-white, #fff)",
            cursor:
              loading || !input.trim() || !hasKey || !hasModel || !hasAnyProvider
                ? "default"
                : "pointer",
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
  background: "var(--yt-spec-general-background-a, rgba(0,0,0,0.4))",
  border:
    "1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.15))",
  borderRadius: 16,
  color: "var(--yt-spec-text-primary, #f1f1f1)",
  padding: "5px 10px",
  fontSize: 12,
  cursor: "pointer",
  flex: 1,
  outline: "none",
  fontFamily: "'Roboto', 'Arial', sans-serif",
};
