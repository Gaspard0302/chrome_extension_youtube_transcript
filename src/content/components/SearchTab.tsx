import React, { useState, useCallback, useRef } from "react";
import type { EmbeddedSegment, SearchResult } from "../../types";
import { exactSearch, hybridSearch, highlightText } from "../../lib/search";
import { formatTimestamp } from "../../lib/transcript";

interface Props {
  segments: EmbeddedSegment[];
  semanticEnabled: boolean;
}

export default function SearchTab({ segments, semanticEnabled }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const res = semanticEnabled
          ? await hybridSearch(q, segments)
          : exactSearch(q, segments).map((r) => ({ ...r }));
        setResults(res);
      } finally {
        setSearching(false);
      }
    },
    [segments, semanticEnabled]
  );

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(q), 400);
  }

  function jumpTo(seconds: number) {
    const video = document.querySelector<HTMLVideoElement>("video");
    if (video) {
      video.currentTime = seconds;
      video.play();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Search input */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #3F3F3F" }}>
        <div style={{ position: "relative" }}>
          <input
            type="text"
            value={query}
            onChange={handleInput}
            placeholder={
              semanticEnabled
                ? "Search by meaning or keyword…"
                : "Search transcript…"
            }
            style={{
              width: "100%",
              background: "#212121",
              border: "1px solid #3F3F3F",
              borderRadius: 6,
              padding: "9px 36px 9px 12px",
              color: "#F1F1F1",
              fontSize: 13,
              outline: "none",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#FF0000")}
            onBlur={(e) => (e.target.style.borderColor = "#3F3F3F")}
          />
          {searching && (
            <div
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                width: 14,
                height: 14,
                border: "2px solid #3F3F3F",
                borderTopColor: "#FF0000",
                borderRadius: "50%",
                animation: "spin 0.6s linear infinite",
              }}
            />
          )}
        </div>
        {semanticEnabled && (
          <p style={{ marginTop: 6, fontSize: 11, color: "#AAAAAA" }}>
            AI semantic search active — finds related concepts too
          </p>
        )}
      </div>

      {/* Results */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 0",
        }}
      >
        {query && !searching && results.length === 0 && (
          <div style={{ padding: "16px", color: "#AAAAAA", fontSize: 13 }}>
            No results found.
          </div>
        )}

        {results.map((result, i) => (
          <ResultCard
            key={i}
            result={result}
            query={query}
            onJump={jumpTo}
          />
        ))}
      </div>
    </div>
  );
}

function ResultCard({
  result,
  query,
  onJump,
}: {
  result: SearchResult;
  query: string;
  onJump: (s: number) => void;
}) {
  const highlighted = highlightText(result.segment.text, query);

  return (
    <div
      onClick={() => onJump(result.segment.start)}
      style={{
        padding: "10px 16px",
        cursor: "pointer",
        borderBottom: "1px solid #1a1a1a",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLDivElement).style.background = "#1a1a1a")
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLDivElement).style.background = "transparent")
      }
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#FF0000",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatTimestamp(result.segment.start)}
        </span>
        {result.matchType === "semantic" && (
          <span
            style={{
              fontSize: 10,
              background: "#1e3a5f",
              color: "#60a5fa",
              borderRadius: 3,
              padding: "1px 5px",
              fontWeight: 600,
            }}
          >
            AI match
          </span>
        )}
        {result.matchType === "exact" && (
          <span
            style={{
              fontSize: 10,
              background: "#1a2a1a",
              color: "#4ade80",
              borderRadius: 3,
              padding: "1px 5px",
              fontWeight: 600,
            }}
          >
            exact
          </span>
        )}
      </div>
      <p
        style={{ fontSize: 13, color: "#F1F1F1", margin: 0, lineHeight: 1.5 }}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </div>
  );
}
