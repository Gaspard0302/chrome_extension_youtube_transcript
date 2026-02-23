import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  extractVideoId,
  fetchTranscript,
  chunkTranscript,
} from "../../lib/transcript";
import { embedSegments } from "../../lib/embeddings";
import { setSegments } from "../../lib/segment-store";
import type { EmbeddedSegment, Settings, TranscriptSegment } from "../../types";
import { DEFAULT_SETTINGS } from "../../lib/providers";
import ChatTab from "./ChatTab";
import TranscriptTab from "./TranscriptTab";
import TimelineTab from "./TimelineTab";

type Tab = "transcript" | "chat" | "timeline";
type LoadState = "idle" | "fetching" | "embedding" | "ready" | "error";

interface Props {
  triggerContainer: HTMLElement;
  panelContainer: HTMLElement;
}

export default function Panel({ triggerContainer, panelContainer }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("transcript");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadProgress, setLoadProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [rawSegments, setRawSegments] = useState<TranscriptSegment[]>([]);
  const [embeddedSegments, setEmbeddedSegments] = useState<EmbeddedSegment[]>(
    []
  );
  const [settings, setSettings] = useState<Settings>(
    DEFAULT_SETTINGS as Settings
  );
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS as Settings);

  const videoIdRef = useRef<string | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (s) => {
      if (s) {
        setSettings(s as Settings);
        settingsRef.current = s as Settings;
      }
    });
  }, [open]);

  function handleSettingsChange(s: Settings) {
    setSettings(s);
    settingsRef.current = s;
  }

  useEffect(() => {
    if (!open || loadState !== "idle") return;
    const videoId = extractVideoId(window.location.href);
    if (!videoId) {
      setErrorMsg("Could not find a video on this page.");
      setLoadState("error");
      return;
    }
    videoIdRef.current = videoId;
    loadTranscript(videoId);
  }, [open]);

  async function loadTranscript(videoId: string) {
    try {
      setLoadState("fetching");

      const { segments } = await fetchTranscript(videoId);
      const chunks = chunkTranscript(segments);
      setRawSegments(chunks);

      if (settingsRef.current.semanticSearchEnabled) {
        try {
          setLoadState("embedding");
          const embedded = await embedSegments(chunks, (pct) =>
            setLoadProgress(pct)
          );
          setEmbeddedSegments(embedded);
        } catch (embErr) {
          console.warn(
            "[YT Transcript] Embedding failed, falling back to exact search:",
            embErr
          );
          // embeddedSegments stays [] → semanticEnabled becomes false
        }
      }

      setLoadState("ready");
    } catch (err) {
      setErrorMsg("Failed to load transcript.");
      setLoadState("error");
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "transcript", label: "Transcript" },
    { id: "chat", label: "AI Chat" },
    { id: "timeline", label: "Timeline" },
  ];

  const embeddedOrRaw: EmbeddedSegment[] =
    embeddedSegments.length > 0
      ? embeddedSegments
      : rawSegments.map((s, i) => ({ ...s, embedding: [], index: i }));

  // Keep the shared segment store in sync so SEARCH_REQUEST handlers in
  // content/index.tsx can run searches on behalf of the background worker.
  useEffect(() => {
    setSegments(embeddedOrRaw);
  }, [embeddedOrRaw]);

  const trigger = (
    <button
      onClick={() => setOpen((v) => !v)}
      title={open ? "Close TranscriptAI" : "Open TranscriptAI"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        background: open
          ? "var(--yt-spec-text-primary, #f1f1f1)"
          : "var(--yt-spec-badge-chip-background, #272727)",
        color: open
          ? "var(--yt-spec-base-background, #0f0f0f)"
          : "var(--yt-spec-text-primary, #f1f1f1)",
        border: "none",
        borderRadius: "18px",
        padding: "0 12px",
        height: "36px",
        cursor: "pointer",
        fontFamily: "'Roboto', 'Arial', sans-serif",
        fontSize: "14px",
        fontWeight: 500,
        whiteSpace: "nowrap",
        transition: "background 0.15s, color 0.15s",
        flexShrink: 0,
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z" />
      </svg>
      TranscriptAI
    </button>
  );

  const panel = open ? (
    <div
      className="yt-transcript-ext"
      tabIndex={-1}
      style={{
        background: "var(--yt-spec-brand-background-solid, #212121)",
        borderRadius: "12px",
        overflow: "hidden",
        marginBottom: "16px",
        fontFamily: "'Roboto', 'Arial', sans-serif",
        color: "var(--yt-spec-text-primary, #f1f1f1)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px 0",
          borderBottom:
            "1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1))",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "12px",
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: 14,
              color: "var(--yt-spec-text-primary, #f1f1f1)",
            }}
          >
            TranscriptAI
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: "var(--yt-spec-text-secondary, #aaa)",
            }}
          >
            {loadState === "ready" && `${rawSegments.length} chunks`}
            {loadState === "embedding" && `Embedding… ${loadProgress}%`}
            {loadState === "fetching" && "Fetching…"}
          </span>
          <button
            onClick={() => setOpen(false)}
            title="Close"
            style={{
              marginLeft: 8,
              background: "transparent",
              border: "none",
              color: "var(--yt-spec-text-secondary, #aaa)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "0 2px",
              flexShrink: 0,
              fontFamily: "inherit",
            }}
          >
            ×
          </button>
        </div>

        {/* Chip-style tabs */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            paddingBottom: "12px",
            flexWrap: "wrap",
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                (document.activeElement as HTMLElement)?.blur();
                setTab(t.id);
              }}
              style={{
                padding: "0 12px",
                height: "32px",
                borderRadius: "16px",
                border: "none",
                background:
                  tab === t.id
                    ? "var(--yt-spec-text-primary, #f1f1f1)"
                    : "var(--yt-spec-10-percent-layer, rgba(255,255,255,0.05))",
                color:
                  tab === t.id
                    ? "var(--yt-spec-base-background, #0f0f0f)"
                    : "var(--yt-spec-text-primary, #f1f1f1)",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: tab === t.id ? 600 : 400,
                fontFamily: "inherit",
                transition: "background 0.15s, color 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div
        tabIndex={-1}
        style={{
          maxHeight: "480px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {loadState === "error" && (
          <div
            style={{
              padding: 16,
              color: "#f87171",
              fontSize: 13,
            }}
          >
            {errorMsg}
          </div>
        )}

        {(loadState === "fetching" || loadState === "embedding") && (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--yt-spec-text-secondary, #aaa)",
              fontSize: 13,
            }}
          >
            <div style={{ marginBottom: 8 }}>
              {loadState === "fetching"
                ? "Fetching transcript…"
                : `Building search index… ${loadProgress}%`}
            </div>
            <div
              style={{
                height: 3,
                background:
                  "var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1))",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  background:
                    "var(--yt-spec-call-to-action-inverse-color, #ff0000)",
                  width:
                    loadState === "fetching" ? "30%" : `${loadProgress}%`,
                  transition: "width 0.3s",
                }}
              />
            </div>
          </div>
        )}

        {loadState === "ready" && (
          <>
            {tab === "transcript" && (
              <TranscriptTab
                segments={embeddedOrRaw}
                semanticEnabled={
                  settings.semanticSearchEnabled && embeddedSegments.length > 0
                }
              />
            )}
            {tab === "chat" && (
              <ChatTab
                segments={rawSegments}
                settings={settings}
                onSettingsChange={handleSettingsChange}
                videoId={videoIdRef.current}
              />
            )}
            {tab === "timeline" && (
              <TimelineTab
                segments={embeddedOrRaw}
                settings={settings}
                videoId={videoIdRef.current}
              />
            )}
          </>
        )}

        {loadState === "idle" && (
          <div
            style={{
              padding: 24,
              color: "var(--yt-spec-text-secondary, #aaa)",
              fontSize: 13,
            }}
          >
            Opening panel…
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      {createPortal(trigger, triggerContainer)}
      {createPortal(panel ?? <></>, panelContainer)}
    </>
  );
}
