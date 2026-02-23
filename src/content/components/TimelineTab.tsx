import React, { useEffect, useRef, useState } from "react";
import type { Settings, TranscriptSegment } from "../../types";
import { PROVIDERS } from "../../lib/providers";
import { formatTimestamp } from "../../lib/transcript";

interface TimelineBlock {
  startTime: number;
  endTime: number;
  title: string | null;
  segments: TranscriptSegment[];
}

interface Props {
  segments: TranscriptSegment[];
  settings: Settings;
}

// Group transcript segments into ~targetCount evenly-sized time blocks.
function groupIntoBlocks(
  segments: TranscriptSegment[],
  targetCount: number = 15
): TimelineBlock[] {
  if (!segments.length) return [];
  const blockSize = Math.max(1, Math.ceil(segments.length / targetCount));
  const totalDuration =
    segments[segments.length - 1].start +
    (segments[segments.length - 1].duration || 60);

  const blocks: TimelineBlock[] = [];
  for (let i = 0; i < segments.length; i += blockSize) {
    const blockSegs = segments.slice(i, i + blockSize);
    const startTime = blockSegs[0].start;
    const endTime =
      i + blockSize < segments.length
        ? segments[i + blockSize].start
        : totalDuration;
    blocks.push({ startTime, endTime, title: null, segments: blockSegs });
  }
  return blocks;
}

export default function TimelineTab({ segments, settings }: Props) {
  const [blocks, setBlocks] = useState<TimelineBlock[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const hasGeneratedRef = useRef(false);

  const availableProviders = PROVIDERS.filter(
    (p) => !p.requiresKey || (settings.apiKeys[p.id] ?? "").length > 0
  );
  const hasProvider = availableProviders.length > 0;
  const apiKey = settings.apiKeys[settings.selectedProvider] ?? "";

  // Group segments on mount / when segments change
  useEffect(() => {
    if (!segments.length) return;
    setBlocks(groupIntoBlocks(segments));
    hasGeneratedRef.current = false;
  }, [segments]);

  // Auto-generate when blocks are ready and provider is available
  useEffect(() => {
    if (
      blocks.length > 0 &&
      hasProvider &&
      !hasGeneratedRef.current &&
      !generating
    ) {
      hasGeneratedRef.current = true;
      generateTitles(blocks);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks.length, hasProvider]);

  async function generateTitles(currentBlocks: TimelineBlock[]) {
    setGenerating(true);
    setGenError("");

    const inputBlocks = currentBlocks.map((b) => ({
      startTime: b.startTime,
      endTime: b.endTime,
      // Send up to ~600 chars of transcript per block so the prompt stays compact
      text: b.segments
        .map((s) => s.text)
        .join(" ")
        .slice(0, 600),
    }));

    try {
      const response = await chrome.runtime.sendMessage({
        type: "GENERATE_TIMELINE",
        payload: {
          blocks: inputBlocks,
          provider: settings.selectedProvider,
          model: settings.selectedModel,
          apiKey,
          ollamaBaseUrl: settings.ollamaBaseUrl,
        },
      });

      if (response?.error) {
        setGenError(response.error);
      } else if (response?.titles) {
        const titles: string[] = response.titles;
        setBlocks((prev) =>
          prev.map((b, i) => ({
            ...b,
            title: titles[i] ?? `Segment ${i + 1}`,
          }))
        );
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setGenerating(false);
    }
  }

  function jumpTo(seconds: number) {
    const video = document.querySelector<HTMLVideoElement>("video");
    if (video) {
      video.currentTime = seconds;
      video.play();
    }
  }

  if (!segments.length) {
    return (
      <div
        style={{
          padding: 24,
          color: "var(--yt-spec-text-secondary, #aaa)",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        No transcript loaded.
      </div>
    );
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
      {/* Header row */}
      <div
        style={{
          padding: "8px 14px",
          borderBottom:
            "1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1))",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: "var(--yt-spec-text-secondary, #aaa)",
            flex: 1,
          }}
        >
          {blocks.length} segments
          {generating && " · generating titles…"}
          {!hasProvider && " · add an API key to generate titles"}
        </span>
        {hasProvider && !generating && (
          <button
            type="button"
            onClick={() => {
              hasGeneratedRef.current = true;
              generateTitles(blocks);
            }}
            style={{
              background: "transparent",
              border:
                "1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.2))",
              borderRadius: 12,
              color: "var(--yt-spec-text-secondary, #aaa)",
              cursor: "pointer",
              fontSize: 11,
              padding: "3px 10px",
              fontFamily: "inherit",
            }}
          >
            Regenerate
          </button>
        )}
      </div>

      {genError && (
        <div
          style={{
            padding: "6px 14px",
            fontSize: 11,
            color: "#f87171",
            flexShrink: 0,
          }}
        >
          Error: {genError}
        </div>
      )}

      {/* Timeline list */}
      <div
        className="yt-transcript-scrollable"
        style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}
      >
        {blocks.map((block, idx) => {
          const isLoading = generating && block.title === null;
          return (
            <div
              key={idx}
              onClick={() => jumpTo(block.startTime)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 0,
                padding: "0 14px",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                  "var(--yt-spec-10-percent-layer, rgba(255,255,255,0.04))";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                  "transparent";
              }}
            >
              {/* Timeline spine */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  width: 20,
                  flexShrink: 0,
                  paddingTop: 14,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background:
                      "var(--yt-spec-call-to-action-inverse-color, #ff0000)",
                    flexShrink: 0,
                  }}
                />
                {idx < blocks.length - 1 && (
                  <div
                    style={{
                      width: 2,
                      flex: 1,
                      minHeight: 24,
                      background:
                        "var(--yt-spec-10-percent-layer, rgba(255,255,255,0.12))",
                      margin: "3px 0",
                    }}
                  />
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, padding: "8px 0 8px 10px" }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color:
                      "var(--yt-spec-call-to-action-inverse-color, #ff0000)",
                    fontVariantNumeric: "tabular-nums",
                    display: "block",
                    marginBottom: 2,
                  }}
                >
                  {formatTimestamp(block.startTime)}
                </span>
                {isLoading ? (
                  <div
                    style={{
                      height: 12,
                      width: "60%",
                      borderRadius: 6,
                      background:
                        "var(--yt-spec-10-percent-layer, rgba(255,255,255,0.08))",
                      animation: "yt-transcript-pulse 1.2s ease-in-out infinite",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: 13,
                      color: block.title
                        ? "var(--yt-spec-text-primary, #f1f1f1)"
                        : "var(--yt-spec-text-secondary, #aaa)",
                      lineHeight: 1.4,
                    }}
                  >
                    {block.title ?? `Segment ${idx + 1}`}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
