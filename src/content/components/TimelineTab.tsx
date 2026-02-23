import React, { useEffect, useRef, useState } from "react";
import type { EmbeddedSegment, Settings } from "../../types";
import { PROVIDERS } from "../../lib/providers";
import { formatTimestamp } from "../../lib/transcript";

// ---------------------------------------------------------------------------
// Segmentation helpers
// ---------------------------------------------------------------------------

const MIN_SECS = 90;   // 1.5 min — never split more finely than this
const TARGET_SECS = 150; // 2.5 min target per block
const MAX_BLOCKS = 25;
const WINDOW = 3;      // segments to average on each side of a candidate boundary

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function cosine(a: number[], b: number[]): number {
  const d = Math.sqrt(dot(a, a)) * Math.sqrt(dot(b, b));
  return d === 0 ? 1 : Math.max(-1, Math.min(1, dot(a, b) / d));
}

function avgVec(vecs: number[][]): number[] {
  if (!vecs.length || !vecs[0].length) return [];
  const dim = vecs[0].length;
  const out = new Array<number>(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) out[i] += v[i];
  return out.map((x) => x / vecs.length);
}

interface TimelineBlock {
  startTime: number;
  endTime: number;
  title: string | null;
  segments: EmbeddedSegment[];
}

/**
 * Time-based fallback: cut every TARGET_SECS seconds.
 */
function timeBasedGrouping(segs: EmbeddedSegment[]): TimelineBlock[] {
  if (!segs.length) return [];
  const blocks: TimelineBlock[] = [];
  let blockSegs: EmbeddedSegment[] = [];
  let startTime = segs[0].start;

  for (const seg of segs) {
    blockSegs.push(seg);
    if (seg.start - startTime >= TARGET_SECS) {
      const last = blockSegs[blockSegs.length - 1];
      blocks.push({
        startTime,
        endTime: last.start + (last.duration || 0),
        title: null,
        segments: blockSegs,
      });
      blockSegs = [];
      startTime = seg.start + (seg.duration || 0);
    }
  }

  if (blockSegs.length) {
    const last = blockSegs[blockSegs.length - 1];
    blocks.push({
      startTime,
      endTime: last.start + (last.duration || 0),
      title: null,
      segments: blockSegs,
    });
  }
  return blocks;
}

/**
 * Semantic segmentation using TextTiling-inspired cosine similarity between
 * sliding windows on either side of each candidate boundary.
 *
 * Algorithm:
 * 1. For each position i, compute cosine similarity between the average
 *    embedding of the WINDOW segments before and after i.
 *    Low similarity → likely topic change.
 * 2. Find local minima in the similarity curve.
 * 3. Greedily select the deepest minima as boundaries, respecting MIN_SECS.
 */
function semanticGrouping(segs: EmbeddedSegment[]): TimelineBlock[] {
  const n = segs.length;
  const totalDuration = segs[n - 1].start + (segs[n - 1].duration || 0);
  const targetCount = Math.min(
    MAX_BLOCKS,
    Math.max(2, Math.round(totalDuration / TARGET_SECS))
  );

  if (n < WINDOW * 2 + 2) return timeBasedGrouping(segs);

  // Step 1: similarity score at every interior position
  const sims: Array<{ idx: number; score: number }> = [];
  for (let i = WINDOW; i < n - WINDOW; i++) {
    const left = avgVec(segs.slice(i - WINDOW, i).map((s) => s.embedding));
    const right = avgVec(segs.slice(i, i + WINDOW).map((s) => s.embedding));
    sims.push({ idx: i, score: cosine(left, right) });
  }

  // Step 2: local minima (true valley points in the similarity curve)
  const minima = sims.filter((p, j, arr) => {
    const prev = arr[j - 1]?.score ?? 1;
    const next = arr[j + 1]?.score ?? 1;
    return p.score < prev && p.score < next;
  });

  // Step 3: sort by score ascending (lowest sim = strongest topic break)
  minima.sort((a, b) => a.score - b.score);

  // Step 4: greedily pick boundaries respecting minimum gap
  const chosen: number[] = [];
  for (const { idx } of minima) {
    if (chosen.length >= targetCount - 1) break;
    const t = segs[idx].start;
    if (t < MIN_SECS) continue;
    if (totalDuration - t < MIN_SECS) continue;
    const tooClose = chosen.some(
      (c) => Math.abs(segs[c].start - t) < MIN_SECS
    );
    if (!tooClose) chosen.push(idx);
  }

  // Step 5: build blocks
  chosen.sort((a, b) => a - b);
  const cuts = [0, ...chosen, n];
  return cuts.slice(0, -1).map((start, i) => {
    const end = cuts[i + 1];
    const blockSegs = segs.slice(start, end);
    const last = blockSegs[blockSegs.length - 1];
    return {
      startTime: blockSegs[0].start,
      endTime: last.start + (last.duration || 0),
      title: null,
      segments: blockSegs,
    };
  });
}

function groupIntoBlocks(segs: EmbeddedSegment[]): {
  blocks: TimelineBlock[];
  method: "semantic" | "time";
} {
  if (!segs.length) return { blocks: [], method: "time" };
  const hasEmbeddings = segs[0].embedding.length > 0;
  if (hasEmbeddings) {
    return { blocks: semanticGrouping(segs), method: "semantic" };
  }
  return { blocks: timeBasedGrouping(segs), method: "time" };
}

// ---------------------------------------------------------------------------
// Cache helpers  (localStorage, keyed by videoId + method)
// ---------------------------------------------------------------------------

interface TimelineCache {
  segMethod: "semantic" | "time";
  blockCount: number;
  titles: string[];
}

function cacheKey(videoId: string, method: "semantic" | "time") {
  return `yt-transcript-timeline:${videoId}:${method}`;
}

function loadCache(videoId: string, method: "semantic" | "time"): TimelineCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(videoId, method));
    if (!raw) return null;
    return JSON.parse(raw) as TimelineCache;
  } catch {
    return null;
  }
}

function saveCache(videoId: string, method: "semantic" | "time", blocks: TimelineBlock[]) {
  try {
    const data: TimelineCache = {
      segMethod: method,
      blockCount: blocks.length,
      titles: blocks.map((b) => b.title ?? ""),
    };
    localStorage.setItem(cacheKey(videoId, method), JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  segments: EmbeddedSegment[];
  settings: Settings;
  videoId: string | null;
}

export default function TimelineTab({ segments, settings, videoId }: Props) {
  const [blocks, setBlocks] = useState<TimelineBlock[]>([]);
  const [segMethod, setSegMethod] = useState<"semantic" | "time">("time");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const hasGeneratedRef = useRef(false);

  const availableProviders = PROVIDERS.filter(
    (p) => !p.requiresKey || (settings.apiKeys[p.id] ?? "").length > 0
  );
  const hasProvider = availableProviders.length > 0;
  const apiKey = settings.apiKeys[settings.selectedProvider] ?? "";

  // Re-segment whenever the segments prop changes, restoring from cache if available
  useEffect(() => {
    if (!segments.length) return;
    const { blocks: newBlocks, method } = groupIntoBlocks(segments);
    setSegMethod(method);
    hasGeneratedRef.current = false;

    // Try to restore cached titles for this video + method
    if (videoId) {
      const cached = loadCache(videoId, method);
      if (cached && cached.blockCount === newBlocks.length) {
        // Patch titles onto freshly-computed blocks (no AI call needed)
        const restored = newBlocks.map((b, i) => ({
          ...b,
          title: cached.titles[i] || null,
        }));
        setBlocks(restored);
        hasGeneratedRef.current = true; // skip auto-generation
        return;
      }
    }

    setBlocks(newBlocks);
  }, [segments, videoId]);

  // Auto-generate titles once blocks are ready and a provider is available
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
        const updated = currentBlocks.map((b, i) => ({
          ...b,
          title: titles[i] ?? `Segment ${i + 1}`,
        }));
        setBlocks(updated);
        // Persist so the next tab-switch skips generation entirely
        if (videoId) saveCache(videoId, segMethod, updated);
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
      {/* Header */}
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
        <div style={{ flex: 1 }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--yt-spec-text-secondary, #aaa)",
            }}
          >
            {blocks.length} segments
            {generating && " · generating titles…"}
          </span>
          <span
            style={{
              fontSize: 10,
              color: "var(--yt-spec-text-secondary, #666)",
              marginLeft: 6,
            }}
          >
            {segMethod === "semantic" ? "· semantic" : "· time-based"}
          </span>
          {!hasProvider && (
            <span
              style={{
                fontSize: 11,
                color: "#fbbf24",
                marginLeft: 6,
              }}
            >
              · add an API key to generate titles
            </span>
          )}
        </div>
        {hasProvider && !generating && (
          <button
            type="button"
            onClick={() => {
              // Clear cache so fresh titles are saved after regeneration
              if (videoId) {
                try { localStorage.removeItem(cacheKey(videoId, segMethod)); } catch { /* */ }
              }
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
          const durationSecs = block.endTime - block.startTime;
          const durationMins = (durationSecs / 60).toFixed(1);

          return (
            <div
              key={idx}
              onClick={() => jumpTo(block.startTime)}
              style={{
                display: "flex",
                alignItems: "flex-start",
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
              {/* Spine */}
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 6,
                    marginBottom: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color:
                        "var(--yt-spec-call-to-action-inverse-color, #ff0000)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatTimestamp(block.startTime)}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--yt-spec-text-secondary, #666)",
                    }}
                  >
                    {durationMins} min
                  </span>
                </div>
                {isLoading ? (
                  <div
                    style={{
                      height: 12,
                      width: "60%",
                      borderRadius: 6,
                      background:
                        "var(--yt-spec-10-percent-layer, rgba(255,255,255,0.08))",
                      animation:
                        "yt-transcript-pulse 1.2s ease-in-out infinite",
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
