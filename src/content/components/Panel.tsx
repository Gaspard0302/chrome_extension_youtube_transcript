import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  extractVideoId,
  fetchTranscript,
  chunkTranscript,
  formatTimestamp,
  checkTranscriptAvailability,
  NoTranscriptError,
  getYouTubeChapters,
} from "../../lib/transcript";
import type { TranscriptAvailability } from "../../lib/transcript";
import { embedSegments, buildEmbeddingTexts } from "../../lib/embeddings";
import { getVideoTitle } from "../../lib/youtube-dom";
import { setSegments } from "../../lib/segment-store";
import type { EmbeddedSegment, Settings, TranscriptSegment } from "../../types";
import type { FetchDiagnostics } from "../../lib/transcript";
import { DEFAULT_SETTINGS } from "../../lib/providers";
import ChatTab from "./ChatTab";
import TranscriptTab from "./TranscriptTab";
import TimelineTab from "./TimelineTab";

type Tab = "transcript" | "chat" | "timeline" | "debug";
type LoadState = "idle" | "fetching" | "ready" | "error";

interface DebugInfo {
  url: string;
  videoId: string | null;
  runtimeId: string | undefined;
  diagnostics: FetchDiagnostics | null;
  rawError: string | null;
  tracksLen: number | null;
  segmentsLen: number | null;
  chunksLen: number | null;
  userAgent: string;
  timestamp: string;
}

interface Props {
  triggerContainer: HTMLElement;
  panelContainer: HTMLElement;
}

function EmbeddingBanner({ progress }: { progress: number }) {
  return (
    <div style={{
      padding: "6px 12px",
      background: "rgba(0,0,0,0.3)",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      fontSize: 11,
      color: "var(--yt-spec-text-secondary, #aaa)",
      flexShrink: 0,
    }}>
      <div style={{ marginBottom: 4 }}>Building semantic index… {progress}%</div>
      <div style={{ height: 2, background: "rgba(255,255,255,0.1)", borderRadius: 1, overflow: "hidden" }}>
        <div style={{ width: `${progress}%`, height: "100%", background: "var(--yt-spec-call-to-action-inverse-color, #ff0000)", transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

function DebugTab({ debugInfo, loadState, errorMsg }: { debugInfo: DebugInfo | null; loadState: LoadState; errorMsg: string }) {
  const [copied, setCopied] = useState(false);

  const statusColor = (s: "ok" | "warn" | "error") =>
    s === "ok" ? "#4ade80" : s === "warn" ? "#fbbf24" : "#f87171";

  const fullText = debugInfo ? JSON.stringify(debugInfo, null, 2) : "No debug info yet — open the panel to trigger a load.";

  function copyAll() {
    navigator.clipboard.writeText(fullText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  const row = (label: string, value: string | null | undefined, color?: string) => (
    <div style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "#888", minWidth: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: color ?? "#f1f1f1", wordBreak: "break-all", flex: 1 }}>{value ?? "—"}</span>
    </div>
  );

  return (
    <div className="yt-transcript-scrollable" style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Copy button */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={copyAll}
          style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 6, color: copied ? "#4ade80" : "#aaa", cursor: "pointer", fontSize: 11, padding: "4px 10px", fontFamily: "inherit" }}
        >
          {copied ? "Copied!" : "Copy all"}
        </button>
      </div>

      {/* Environment */}
      <section>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Environment</div>
        {row("Load state", loadState, loadState === "error" ? "#f87171" : loadState === "ready" ? "#4ade80" : "#fbbf24")}
        {row("Error msg", errorMsg || null)}
        {row("Runtime ID", debugInfo?.runtimeId ?? (chrome.runtime?.id ?? "MISSING — context invalidated!"), debugInfo?.runtimeId ? undefined : "#f87171")}
        {row("URL", debugInfo?.url ?? window.location.href)}
        {row("Video ID", debugInfo?.videoId ?? "not extracted")}
        {row("Timestamp", debugInfo?.timestamp)}
        {row("User agent", debugInfo?.userAgent)}
      </section>

      {/* Counts */}
      {debugInfo && (
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Counts</div>
          {row("Caption tracks", debugInfo.tracksLen?.toString())}
          {row("Raw segments", debugInfo.segmentsLen?.toString())}
          {row("Chunks", debugInfo.chunksLen?.toString())}
        </section>
      )}

      {/* Diagnostic steps */}
      {debugInfo?.diagnostics && (
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Fetch Steps</div>
          {debugInfo.diagnostics.steps.map((step, i) => (
            <div key={i} style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(255,255,255,0.04)", borderRadius: 6, borderLeft: `3px solid ${statusColor(step.status)}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: statusColor(step.status) }}>{step.status.toUpperCase()}</span>
                <span style={{ fontSize: 11, color: "#f1f1f1" }}>{step.label}</span>
              </div>
              {step.detail && <div style={{ fontSize: 10, color: "#aaa", wordBreak: "break-all", whiteSpace: "pre-wrap" }}>{step.detail}</div>}
            </div>
          ))}
        </section>
      )}

      {/* Raw error */}
      {debugInfo?.rawError && (
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#f87171", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Raw Error</div>
          <pre style={{ fontSize: 10, color: "#f87171", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0, background: "rgba(248,113,113,0.08)", padding: 8, borderRadius: 6 }}>{debugInfo.rawError}</pre>
        </section>
      )}

      {!debugInfo && (
        <div style={{ fontSize: 12, color: "#aaa", textAlign: "center", padding: 24 }}>
          Switch to another tab to trigger a load, then come back here.
        </div>
      )}
    </div>
  );
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
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [settings, setSettings] = useState<Settings>(
    DEFAULT_SETTINGS as Settings
  );
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS as Settings);

  const videoIdRef = useRef<string | null>(null);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(() =>
    extractVideoId(window.location.href)
  );
  // "checking" while the probe runs; the trigger button is hidden for
  // "checking" and "none", shown for "available" and "unknown" (probe failed —
  // give the user the benefit of the doubt).
  const [availability, setAvailability] = useState<TranscriptAvailability | "checking">("checking");
  // Incremented on every video change / load start so an in-flight fetch from
  // a previous video can never write its result into the current video's state.
  const loadSeqRef = useRef(0);

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

  // Reset state when navigating to a new video (SPA nav within watch pages)
  useEffect(() => {
    const handleReset = () => {
      loadSeqRef.current++;
      setLoadState("idle");
      setRawSegments([]);
      setEmbeddedSegments([]);
      setErrorMsg("");
      setDebugInfo(null);
      videoIdRef.current = null;
      setCurrentVideoId(extractVideoId(window.location.href));
    };
    document.addEventListener("yt-transcript-reset", handleReset);
    return () => document.removeEventListener("yt-transcript-reset", handleReset);
  }, []);

  // Probe transcript availability for the current video so the trigger button
  // only appears when a transcript actually exists (or we cannot tell).
  useEffect(() => {
    if (!currentVideoId) {
      setAvailability("none");
      return;
    }
    let cancelled = false;
    setAvailability("checking");
    checkTranscriptAvailability(currentVideoId).then((result) => {
      if (!cancelled) setAvailability(result);
    });
    return () => {
      cancelled = true;
    };
  }, [currentVideoId]);

  useEffect(() => {
    if (!open || loadState !== "idle") return;
    const videoId = currentVideoId ?? extractVideoId(window.location.href);
    if (!videoId) {
      setErrorMsg("Could not find a video on this page.");
      setLoadState("error");
      return;
    }
    videoIdRef.current = videoId;
    loadTranscript(videoId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadState, currentVideoId]);

  async function loadTranscript(videoId: string) {
    const baseDebug: Omit<DebugInfo, "diagnostics" | "rawError" | "tracksLen" | "segmentsLen" | "chunksLen"> = {
      url: window.location.href,
      videoId,
      runtimeId: chrome.runtime?.id,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    };
    // Anything that resolves after the user navigated to another video must
    // be discarded — otherwise the old video's transcript shows on the new one.
    const seq = ++loadSeqRef.current;
    const isStale = () => seq !== loadSeqRef.current;

    try {
      setLoadState("fetching");

      const { segments, tracksLen, diagnostics } = await fetchTranscript(videoId);
      if (isStale()) return;
      const chunks = chunkTranscript(segments);
      setRawSegments(chunks);
      setDebugInfo({ ...baseDebug, diagnostics, rawError: null, tracksLen, segmentsLen: segments.length, chunksLen: chunks.length });
      setLoadState("ready");
      setAvailability("available");

      if (settingsRef.current.semanticSearchEnabled) {
        setIsEmbedding(true);
        setLoadProgress(0);
        try {
          // Embed augmented texts (title/chapter prefix + neighbor overlap);
          // the chunks themselves keep their exact display text.
          const embedTexts = buildEmbeddingTexts(chunks, {
            title: getVideoTitle(),
            chapters: getYouTubeChapters(videoId),
          });
          const embedded = await embedSegments(
            chunks,
            (pct) => {
              if (!isStale()) setLoadProgress(pct);
            },
            embedTexts
          );
          if (!isStale()) setEmbeddedSegments(embedded);
        } catch (embErr) {
          console.warn(
            "[YT Transcript] Embedding failed, falling back to exact search:",
            embErr
          );
        } finally {
          if (!isStale()) setIsEmbedding(false);
        }
      }
    } catch (err) {
      if (isStale()) return;
      const rawError = err instanceof Error
        ? `${err.message}\n\nStack: ${err.stack ?? "n/a"}`
        : String(err);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const diagnostics = (err as any)?.diagnostics ?? null;
      setDebugInfo({ ...baseDebug, diagnostics, rawError, tracksLen: null, segmentsLen: null, chunksLen: null });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (err instanceof NoTranscriptError || (err as any)?.noTranscript) {
        setErrorMsg("This video doesn't have a transcript.");
        setAvailability("none");
      } else {
        setErrorMsg(
          err instanceof Error && err.message
            ? `Couldn't load the transcript: ${err.message}`
            : "Couldn't load the transcript."
        );
      }
      setLoadState("error");
    }
  }

  function copyTranscript() {
    const text = rawSegments
      .map((s) => `[${formatTimestamp(s.start)}] ${s.text}`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Clipboard access denied or not available — silently ignore
    });
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "transcript", label: "Transcript" },
    { id: "chat", label: "AI Chat" },
    { id: "timeline", label: "Timeline" },
    { id: "debug", label: "🐛 Debug" },
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

  // Hide the button entirely when we know the video has no transcript.
  // "unknown" (probe couldn't reach YouTube) still shows it so a transient
  // network hiccup never makes the feature disappear.
  const showTrigger = availability === "available" || availability === "unknown";

  const trigger = showTrigger ? (
    <button
      onClick={() => {
        if (open && loadState === "error") {
          // Retry: reset to idle, keep panel open — useEffect will re-trigger load
          setLoadState("idle");
          setErrorMsg("");
          setRawSegments([]);
          setEmbeddedSegments([]);
        } else {
          setOpen((v) => !v);
        }
      }}
      title={open && loadState === "error" ? "Retry loading transcript" : open ? "Close TranscriptAI" : "Open TranscriptAI"}
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
  ) : null;

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
            alignItems: "flex-start",
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
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {loadState === "ready" && !isEmbedding && `${rawSegments.length} chunks`}
            {loadState === "fetching" && "Fetching…"}
            {isEmbedding && (
              <>
                <span>Indexing… {loadProgress}%</span>
                <div style={{ width: 36, height: 2, background: "rgba(255,255,255,0.1)", borderRadius: 1, overflow: "hidden" }}>
                  <div style={{ width: `${loadProgress}%`, height: "100%", background: "var(--yt-spec-call-to-action-inverse-color, #ff0000)", transition: "width 0.3s" }} />
                </div>
              </>
            )}
          </span>

          <button
            onClick={() => setOpen(false)}
            title="Close"
            style={{
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
            alignItems: "center",
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
          {loadState === "ready" && (
            <button
              type="button"
              onClick={copyTranscript}
              title="Copy transcript"
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: "none",
                color: copied ? "#4ade80" : "var(--yt-spec-text-secondary, #aaa)",
                cursor: "pointer",
                padding: "0 2px",
                display: "flex",
                alignItems: "center",
                flexShrink: 0,
                transition: "color 0.15s",
              }}
            >
              {copied ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                </svg>
              )}
            </button>
          )}
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
              fontSize: 13,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: "flex-start",
            }}
          >
            <span style={{ color: availability === "none" ? "var(--yt-spec-text-secondary, #aaa)" : "#f87171" }}>
              {errorMsg}
            </span>
            {availability !== "none" && (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg("");
                  setLoadState("idle");
                }}
                style={{
                  background: "var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1))",
                  border: "none",
                  borderRadius: 16,
                  color: "var(--yt-spec-text-primary, #f1f1f1)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                  padding: "6px 16px",
                  fontFamily: "inherit",
                }}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {loadState === "fetching" && (
          <div
            style={{
              padding: 24,
              color: "var(--yt-spec-text-secondary, #aaa)",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            Fetching transcript…
          </div>
        )}

        {loadState === "ready" && tab !== "debug" && (
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
              <>
                {isEmbedding && <EmbeddingBanner progress={loadProgress} />}
                <ChatTab
                  segments={rawSegments}
                  settings={settings}
                  onSettingsChange={handleSettingsChange}
                  videoId={videoIdRef.current}
                />
              </>
            )}
            {tab === "timeline" && (
              <>
                {isEmbedding && <EmbeddingBanner progress={loadProgress} />}
                <TimelineTab
                  segments={embeddedOrRaw}
                  settings={settings}
                  videoId={videoIdRef.current}
                />
              </>
            )}
          </>
        )}

        {tab === "debug" && (
          <DebugTab debugInfo={debugInfo} loadState={loadState} errorMsg={errorMsg} />
        )}

        {loadState === "idle" && tab !== "debug" && (
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
