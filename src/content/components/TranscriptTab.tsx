import React, { useRef, useEffect, useState, useCallback } from "react";
import type { EmbeddedSegment } from "../../types";
import { formatTimestamp } from "../../lib/transcript";
import { exactSearch, hybridSearch, highlightText } from "../../lib/search";

interface Props {
  segments: EmbeddedSegment[];
  semanticEnabled: boolean;
}

export default function TranscriptTab({ segments, semanticEnabled }: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    { segment: EmbeddedSegment; highlighted: string; matchType: string }[] | null
  >(null);
  const [searching, setSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync active segment with video playback
  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>("video");
    if (!video) return;

    function onTimeUpdate() {
      const t = video!.currentTime;
      let best = 0;
      for (let i = 0; i < segments.length; i++) {
        if (segments[i].start <= t) best = i;
        else break;
      }
      setActiveIndex(best);
    }

    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [segments]);

  // Auto-scroll to active segment when not searching
  useEffect(() => {
    if (activeIndex === null || searchResults !== null) return;
    const el = containerRef.current?.querySelector(
      `[data-index="${activeIndex}"]`
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, searchResults]);

  function jumpTo(seconds: number) {
    const video = document.querySelector<HTMLVideoElement>("video");
    if (video) {
      video.currentTime = seconds;
      video.play();
    }
  }

  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setSearchResults(null);
        return;
      }
      setSearching(true);
      try {
        const results = semanticEnabled
          ? await hybridSearch(q, segments)
          : exactSearch(q, segments).map((r) => ({ ...r }));

        setSearchResults(
          results.map((r) => ({
            segment: r.segment as EmbeddedSegment,
            highlighted: highlightText(r.segment.text, q),
            matchType: r.matchType,
          }))
        );
      } catch {
        const fallback = exactSearch(q, segments).map((r) => ({
          segment: r.segment as EmbeddedSegment,
          highlighted: highlightText(r.segment.text, q),
          matchType: r.matchType,
        }));
        setSearchResults(fallback);
      } finally {
        setSearching(false);
      }
    },
    [segments, semanticEnabled]
  );

  function handleSearchInput(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setSearchResults(null);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(q), 300);
  }

  function submitSearch() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    runSearch(q);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitSearch();
    }
  }

  const displayItems =
    searchResults !== null
      ? searchResults
      : segments.map((seg) => ({
          segment: seg,
          highlighted: "",
          matchType: "",
        }));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Pinned search bar */}
      <div
        style={{
          padding: "10px 12px",
          borderBottom:
            "1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1))",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "center",
          }}
        >
          <div style={{ position: "relative", flex: 1 }}>
            <input
              type="text"
              value={query}
              onChange={handleSearchInput}
              onKeyDown={handleSearchKeyDown}
              placeholder={
              semanticEnabled
                ? "Filter by meaning or keyword…"
                : "Filter transcript…"
            }
            style={{
              width: "100%",
              background:
                "var(--yt-spec-general-background-a, rgba(0,0,0,0.3))",
              border:
                "1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1))",
              borderRadius: "20px",
              padding: "8px 32px 8px 14px",
              color: "var(--yt-spec-text-primary, #f1f1f1)",
              fontSize: 13,
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
            onFocus={(e) =>
              (e.target.style.borderColor =
                "var(--yt-spec-call-to-action-inverse-color, #ff0000)")
            }
            onBlur={(e) =>
              (e.target.style.borderColor =
                "var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1))")
            }
            />
            {searching ? (
            <div
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                width: 14,
                height: 14,
                border:
                  "2px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.2))",
                borderTopColor:
                  "var(--yt-spec-call-to-action-inverse-color, #ff0000)",
                borderRadius: "50%",
                animation: "yt-transcript-spin 0.6s linear infinite",
              }}
            />
          ) : query ? (
            <button
              onClick={() => {
                setQuery("");
                setSearchResults(null);
              }}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                color: "var(--yt-spec-text-secondary, #aaa)",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
                fontFamily: "inherit",
              }}
              title="Clear search"
            >
              ×
            </button>
          ) : null}
          </div>
          <button
            type="button"
            onClick={submitSearch}
            disabled={searching || !query.trim()}
            style={{
              flexShrink: 0,
              padding: "8px 14px",
              borderRadius: "18px",
              border: "none",
              background:
                "var(--yt-spec-call-to-action-inverse-color, #ff0000)",
              color: "var(--yt-spec-static-brand-white, #fff)",
              fontSize: 13,
              fontWeight: 600,
              cursor: searching || !query.trim() ? "default" : "pointer",
              fontFamily: "inherit",
              opacity: searching || !query.trim() ? 0.6 : 1,
            }}
          >
            Search
          </button>
        </div>
        {query && searchResults !== null && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 11,
              color: "var(--yt-spec-text-secondary, #aaa)",
            }}
          >
            {searchResults.length === 0
              ? "No results"
              : `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}`}
            {semanticEnabled && " · AI semantic search active"}
          </p>
        )}
      </div>

      {/* Segment list */}
      <div
        ref={containerRef}
        className="yt-transcript-scrollable"
        style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}
      >
        {displayItems.length === 0 && query && (
          <div
            style={{
              padding: "16px 12px",
              color: "var(--yt-spec-text-secondary, #aaa)",
              fontSize: 13,
            }}
          >
            No results for &ldquo;{query}&rdquo;
          </div>
        )}

        {displayItems.map(({ segment, highlighted, matchType }) => {
          const isActive = !query && activeIndex === segment.index;

          return (
            <div
              key={segment.index}
              data-index={segment.index}
              onClick={() => jumpTo(segment.start)}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                background: isActive
                  ? "var(--yt-spec-10-percent-layer, rgba(255,255,255,0.05))"
                  : "transparent",
                borderLeft: isActive
                  ? "3px solid var(--yt-spec-call-to-action-inverse-color, #ff0000)"
                  : "3px solid transparent",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLDivElement).style.background =
                    "var(--yt-spec-10-percent-layer, rgba(255,255,255,0.05))";
              }}
              onMouseLeave={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLDivElement).style.background =
                    "transparent";
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 2,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: isActive
                      ? "var(--yt-spec-call-to-action-inverse-color, #ff0000)"
                      : "var(--yt-spec-text-secondary, #aaa)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatTimestamp(segment.start)}
                </span>
                {matchType === "semantic" && (
                  <span
                    style={{
                      fontSize: 10,
                      background: "rgba(59,130,246,0.15)",
                      color: "#60a5fa",
                      borderRadius: 3,
                      padding: "1px 5px",
                      fontWeight: 600,
                    }}
                  >
                    AI
                  </span>
                )}
              </div>
              {highlighted ? (
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: "var(--yt-spec-text-primary, #f1f1f1)",
                    lineHeight: 1.5,
                  }}
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
              ) : (
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: isActive
                      ? "var(--yt-spec-text-primary, #f1f1f1)"
                      : "var(--yt-spec-text-secondary, #aaa)",
                    lineHeight: 1.5,
                  }}
                >
                  {segment.text}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
