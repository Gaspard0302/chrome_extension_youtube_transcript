import React, { useState, useRef, useEffect } from "react";
import type { ChatMessage, Settings, TranscriptSegment } from "../../types";
import { formatTimestamp } from "../../lib/transcript";
import { PROVIDERS } from "../../lib/providers";

interface Props {
  segments: TranscriptSegment[];
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

export default function ChatTab({ segments, settings, onSettingsChange }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingTextRef = useRef("");

  const provider = PROVIDERS.find((p) => p.id === settings.selectedProvider);
  const apiKey = settings.apiKeys[settings.selectedProvider] ?? "";
  const hasKey = !provider?.requiresKey || apiKey.length > 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function buildSystemPrompt(): string {
    const fullTranscript = segments
      .map((s) => `[${formatTimestamp(s.start)}] ${s.text}`)
      .join("\n");

    return `You are a helpful assistant answering questions about a YouTube video.
You have access to the full transcript below. When relevant, cite specific timestamps like [1:23] so the user can jump to that moment.

TRANSCRIPT:
${fullTranscript}

Rules:
- Answer based on the transcript content
- Cite timestamps for specific claims using the format [MM:SS] or [H:MM:SS]
- If the video doesn't cover the topic, say so clearly
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
    streamingTextRef.current = "";

    // Add empty assistant message for streaming
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "" },
    ]);

    // Listen for streamed chunks from background
    const chunkListener = (msg: { type: string; payload: { chunk: string; fullText: string } }) => {
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
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          systemPrompt: buildSystemPrompt(),
          provider: settings.selectedProvider,
          model: settings.selectedModel,
          apiKey,
          ollamaBaseUrl: settings.ollamaBaseUrl,
        },
      });

      if (response?.error) {
        setError(response.error);
        setMessages((prev) => prev.slice(0, -1)); // remove empty assistant msg
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

  // Parse [MM:SS] citations in text and make them clickable
  function renderMessageContent(content: string) {
    const parts = content.split(/(\[\d+:\d{2}(?::\d{2})?\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+):(\d{2})(?::(\d{2}))?\]/);
      if (match) {
        const h = match[3] !== undefined ? parseInt(match[1]) : 0;
        const m = match[3] !== undefined ? parseInt(match[2]) : parseInt(match[1]);
        const s = match[3] !== undefined ? parseInt(match[3]) : parseInt(match[2]);
        const seconds = h * 3600 + m * 60 + s;
        return (
          <button
            key={i}
            onClick={() => jumpTo(seconds)}
            style={{
              background: "#1e1e1e",
              border: "1px solid #3F3F3F",
              borderRadius: 4,
              color: "#FF0000",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              padding: "1px 6px",
              margin: "0 2px",
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Model selector bar */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #3F3F3F",
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <select
          value={settings.selectedProvider}
          onChange={(e) => {
            const p = PROVIDERS.find((pr) => pr.id === e.target.value)!;
            onSettingsChange({
              ...settings,
              selectedProvider: p.id,
              selectedModel: p.models[0].id,
            });
          }}
          style={selectStyle}
        >
          {PROVIDERS.map((p) => (
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
          {(provider?.models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {!hasKey && (
        <div
          style={{
            margin: "8px 12px",
            padding: "8px 10px",
            background: "#2a1a00",
            border: "1px solid #7c4a00",
            borderRadius: 6,
            fontSize: 12,
            color: "#fbbf24",
          }}
        >
          No API key set for {provider?.label}. Add one in the extension settings.
        </div>
      )}

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "#AAAAAA",
              fontSize: 13,
              marginTop: 24,
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
                maxWidth: "85%",
                padding: "9px 12px",
                borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                background: msg.role === "user" ? "#CC0000" : "#212121",
                fontSize: 13,
                lineHeight: 1.6,
                color: "#F1F1F1",
              }}
            >
              {msg.role === "assistant"
                ? renderMessageContent(msg.content)
                : msg.content}
              {loading && i === messages.length - 1 && msg.role === "assistant" && !msg.content && (
                <span style={{ color: "#AAAAAA" }}>▋</span>
              )}
            </div>
          </div>
        ))}

        {error && (
          <div style={{ color: "#f87171", fontSize: 12, padding: "4px 0" }}>
            Error: {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid #3F3F3F",
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about the video… (Enter to send)"
          disabled={loading || !hasKey}
          rows={1}
          style={{
            flex: 1,
            background: "#212121",
            border: "1px solid #3F3F3F",
            borderRadius: 8,
            padding: "9px 12px",
            color: "#F1F1F1",
            fontSize: 13,
            resize: "none",
            outline: "none",
            fontFamily: "inherit",
            lineHeight: 1.5,
            maxHeight: 100,
            overflow: "auto",
          }}
          onFocus={(e) => (e.target.style.borderColor = "#FF0000")}
          onBlur={(e) => (e.target.style.borderColor = "#3F3F3F")}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim() || !hasKey}
          style={{
            background: loading || !input.trim() || !hasKey ? "#3F3F3F" : "#FF0000",
            border: "none",
            borderRadius: 8,
            color: "white",
            cursor: loading || !input.trim() || !hasKey ? "default" : "pointer",
            padding: "9px 14px",
            fontSize: 13,
            fontWeight: 700,
            transition: "background 0.15s",
          }}
        >
          {loading ? "…" : "↑"}
        </button>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: "#212121",
  border: "1px solid #3F3F3F",
  borderRadius: 5,
  color: "#F1F1F1",
  padding: "5px 8px",
  fontSize: 11,
  cursor: "pointer",
  flex: 1,
  outline: "none",
};
