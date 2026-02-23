import React, { useEffect, useRef, useState } from "react";
import { extractVideoId, fetchTranscript, chunkTranscript } from "../../lib/transcript";
import type { FetchDiagnostics } from "../../lib/transcript";
import { embedSegments } from "../../lib/embeddings";
import type { EmbeddedSegment, Settings, TranscriptSegment } from "../../types";
import { DEFAULT_SETTINGS } from "../../lib/providers";
import SearchTab from "./SearchTab";
import ChatTab from "./ChatTab";
import TranscriptTab from "./TranscriptTab";
import DetailsTab from "./DetailsTab";

type Tab = "search" | "chat" | "transcript" | "details";
type LoadState = "idle" | "fetching" | "embedding" | "ready" | "error";

export default function Panel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("search");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadProgress, setLoadProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<FetchDiagnostics | null>(null);

  const [rawSegments, setRawSegments] = useState<TranscriptSegment[]>([]);
  const [embeddedSegments, setEmbeddedSegments] = useState<EmbeddedSegment[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS as Settings);

  const videoIdRef = useRef<string | null>(null);

  // Load settings once
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (s) => {
      if (s) setSettings(s as Settings);
    });
  }, []);

  // Load transcript when panel opens
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
      setErrorDetails(null);
      setDiagnostics(null);

      const { segments, diagnostics: diag } = await fetchTranscript(videoId);
      setDiagnostics(diag);
      const chunks = chunkTranscript(segments);
      setRawSegments(chunks);

      if (settings.semanticSearchEnabled) {
        setLoadState("embedding");
        const embedded = await embedSegments(chunks, (pct) =>
          setLoadProgress(pct)
        );
        setEmbeddedSegments(embedded);
      }

      setLoadState("ready");
    } catch (err) {
      setErrorMsg("Failed to load transcript.");
      setErrorDetails(err instanceof Error ? err.stack || err.message : String(err));
      const diagFromErr = (err as { diagnostics?: FetchDiagnostics }).diagnostics;
      if (diagFromErr) setDiagnostics(diagFromErr);
      setLoadState("error");
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "search", label: "Search" },
    { id: "chat", label: "Chat" },
    { id: "transcript", label: "Transcript" },
    { id: "details", label: "Details" },
  ];

  return (
    <div style={{ pointerEvents: "auto" }}>
      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "fixed",
          top: "50%",
          right: open ? "380px" : "0px",
          transform: "translateY(-50%)",
          transition: "right 0.3s ease",
          zIndex: 10000,
          background: "#FF0000",
          color: "white",
          border: "none",
          borderRadius: "6px 0 0 6px",
          padding: "12px 6px",
          cursor: "pointer",
          fontSize: "10px",
          fontWeight: "bold",
          letterSpacing: "1px",
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        title={open ? "Close transcript panel" : "Open transcript search"}
      >
        TRANSCRIPT
      </button>

      {/* Sidebar */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: open ? 0 : "-380px",
          width: "380px",
          height: "100vh",
          background: "#0F0F0F",
          borderLeft: "1px solid #3F3F3F",
          display: "flex",
          flexDirection: "column",
          transition: "right 0.3s ease",
          zIndex: 9999,
          fontFamily: "'Roboto', 'Arial', sans-serif",
          color: "#F1F1F1",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 16px 0",
            borderBottom: "1px solid #3F3F3F",
            background: "#0F0F0F",
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
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#FF0000",
                flexShrink: 0,
              }}
            />
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              Transcript Search
            </span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "#AAAAAA" }}>
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
                color: "#AAAAAA",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
                padding: "0 2px",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#F1F1F1")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#AAAAAA")}
            >
              ×
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2 }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  background: "transparent",
                  border: "none",
                  borderBottom: tab === t.id ? "2px solid #FF0000" : "2px solid transparent",
                  color: tab === t.id ? "#F1F1F1" : "#AAAAAA",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: tab === t.id ? 600 : 400,
                  transition: "all 0.15s",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {loadState === "error" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{ padding: 16, color: "#f87171", fontSize: 13, borderBottom: "1px solid #3F3F3F" }}>
                {errorMsg} Check the <strong>Details</strong> tab for more information.
              </div>
              {tab === "details" && <DetailsTab segments={rawSegments} errorDetails={errorDetails} diagnostics={diagnostics} />}
            </div>
          )}

          {(loadState === "fetching" || loadState === "embedding") && (
            <div style={{ padding: 24, textAlign: "center", color: "#AAAAAA", fontSize: 13 }}>
              <div style={{ marginBottom: 8 }}>
                {loadState === "fetching" ? "Fetching transcript…" : `Building search index… ${loadProgress}%`}
              </div>
              <div
                style={{
                  height: 3,
                  background: "#3F3F3F",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    background: "#FF0000",
                    width: loadState === "fetching" ? "30%" : `${loadProgress}%`,
                    transition: "width 0.3s",
                  }}
                />
              </div>
            </div>
          )}

          {loadState === "ready" && (
            <>
              {tab === "search" && (
                <SearchTab
                  segments={embeddedSegments.length > 0 ? embeddedSegments : rawSegments.map((s, i) => ({ ...s, embedding: [], index: i }))}
                  semanticEnabled={settings.semanticSearchEnabled && embeddedSegments.length > 0}
                />
              )}
              {tab === "chat" && (
                <ChatTab
                  segments={rawSegments}
                  settings={settings}
                  onSettingsChange={setSettings}
                />
              )}
              {tab === "transcript" && (
                <TranscriptTab segments={rawSegments} />
              )}
              {tab === "details" && (
                <DetailsTab segments={rawSegments} errorDetails={errorDetails} diagnostics={diagnostics} />
              )}
            </>
          )}

          {loadState === "idle" && (
            <div style={{ padding: 24, color: "#AAAAAA", fontSize: 13 }}>
              Opening panel…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
