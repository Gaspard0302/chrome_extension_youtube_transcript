import React, { useRef, useEffect, useState } from "react";
import type { TranscriptSegment } from "../../types";
import { formatTimestamp } from "../../lib/transcript";

interface Props {
  segments: TranscriptSegment[];
}

export default function TranscriptTab({ segments }: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync with video playback position
  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>("video");
    if (!video) return;

    function onTimeUpdate() {
      const t = video!.currentTime;
      // Find the segment currently being played
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

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeIndex === null) return;
    const el = containerRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  function jumpTo(seconds: number) {
    const video = document.querySelector<HTMLVideoElement>("video");
    if (video) {
      video.currentTime = seconds;
      video.play();
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "8px 0",
      }}
    >
      {segments.map((seg, i) => (
        <div
          key={i}
          data-index={i}
          onClick={() => jumpTo(seg.start)}
          style={{
            padding: "8px 16px",
            cursor: "pointer",
            background: activeIndex === i ? "#1a1a1a" : "transparent",
            borderLeft: activeIndex === i ? "3px solid #FF0000" : "3px solid transparent",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            if (activeIndex !== i)
              (e.currentTarget as HTMLDivElement).style.background = "#141414";
          }}
          onMouseLeave={(e) => {
            if (activeIndex !== i)
              (e.currentTarget as HTMLDivElement).style.background = "transparent";
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: activeIndex === i ? "#FF0000" : "#AAAAAA",
              fontVariantNumeric: "tabular-nums",
              display: "block",
              marginBottom: 2,
            }}
          >
            {formatTimestamp(seg.start)}
          </span>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: activeIndex === i ? "#F1F1F1" : "#CCCCCC",
              lineHeight: 1.5,
            }}
          >
            {seg.text}
          </p>
        </div>
      ))}
    </div>
  );
}
