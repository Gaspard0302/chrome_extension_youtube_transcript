import React from "react";
import type { TranscriptSegment } from "../../types";
import type { FetchDiagnostics } from "../../lib/transcript";

interface Props {
  segments: TranscriptSegment[];
  errorDetails?: string | null;
  diagnostics?: FetchDiagnostics | null;
}

const STATUS_COLORS: Record<string, string> = {
  ok: "#4ade80",
  warn: "#facc15",
  error: "#f87171",
};

const STATUS_ICONS: Record<string, string> = {
  ok: "✓",
  warn: "⚠",
  error: "✗",
};

export default function DetailsTab({
  segments,
  errorDetails,
  diagnostics,
}: Props) {
  const totalWords = segments.reduce(
    (acc, seg) => acc + seg.text.split(" ").length,
    0
  );
  const totalDuration =
    segments.length > 0
      ? segments[segments.length - 1].start +
        segments[segments.length - 1].duration
      : 0;

  return (
    <div
      style={{
        padding: 16,
        fontSize: 13,
        color: "var(--yt-spec-text-secondary, #aaa)",
        overflowY: "auto",
        flex: 1,
        minHeight: 0,
      }}
    >
      <h3
        style={{
          color: "var(--yt-spec-text-primary, #f1f1f1)",
          marginTop: 0,
          marginBottom: 12,
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Debug Details
      </h3>

      {/* Pipeline Steps */}
      {diagnostics && diagnostics.steps.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h4
            style={{
              color: "var(--yt-spec-text-primary, #f1f1f1)",
              marginTop: 0,
              marginBottom: 8,
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              fontWeight: 600,
            }}
          >
            Pipeline Steps
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {diagnostics.steps.map((step, i) => (
              <div
                key={i}
                style={{
                  background:
                    "var(--yt-spec-general-background-a, rgba(0,0,0,0.3))",
                  borderRadius: 6,
                  padding: "8px 10px",
                  borderLeft: `3px solid ${STATUS_COLORS[step.status] ?? "var(--yt-spec-text-secondary, #555)"}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: step.detail ? 4 : 0,
                  }}
                >
                  <span
                    style={{
                      color:
                        STATUS_COLORS[step.status] ??
                        "var(--yt-spec-text-secondary, #555)",
                      fontWeight: 700,
                      fontSize: 12,
                      minWidth: 14,
                    }}
                  >
                    {STATUS_ICONS[step.status] ?? "?"}
                  </span>
                  <span
                    style={{
                      color: "var(--yt-spec-text-primary, #f1f1f1)",
                      fontWeight: 500,
                    }}
                  >
                    {step.label}
                  </span>
                </div>
                {step.detail && (
                  <div
                    style={{
                      marginLeft: 20,
                      color: "var(--yt-spec-text-secondary, #aaa)",
                      fontSize: 11,
                      wordBreak: "break-all",
                    }}
                  >
                    {step.detail}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error Trace */}
      {errorDetails && (
        <div
          style={{
            marginBottom: 20,
            padding: 12,
            background: "rgba(248,113,113,0.08)",
            border: "1px solid #f87171",
            color: "#f87171",
            borderRadius: 6,
          }}
        >
          <strong
            style={{
              display: "block",
              marginBottom: 6,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Full Error Trace
          </strong>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontSize: 11,
              wordBreak: "break-all",
              fontFamily: "monospace",
            }}
          >
            {errorDetails}
          </pre>
        </div>
      )}

      {/* Stats */}
      <h4
        style={{
          color: "var(--yt-spec-text-primary, #f1f1f1)",
          marginTop: 0,
          marginBottom: 8,
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        Transcript Stats
      </h4>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 6,
          marginBottom: 16,
        }}
      >
        {[
          { label: "Segments", value: segments.length },
          { label: "Duration", value: `${Math.round(totalDuration)}s` },
          { label: "Words", value: totalWords },
          {
            label: "Avg words/seg",
            value:
              segments.length > 0
                ? Math.round(totalWords / segments.length)
                : 0,
          },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              background:
                "var(--yt-spec-general-background-a, rgba(0,0,0,0.3))",
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "var(--yt-spec-text-secondary, #aaa)",
                marginBottom: 2,
              }}
            >
              {label}
            </div>
            <div
              style={{
                color: "var(--yt-spec-text-primary, #f1f1f1)",
                fontWeight: 600,
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Segment previews */}
      {segments.length > 0 && (
        <>
          <h4
            style={{
              color: "var(--yt-spec-text-primary, #f1f1f1)",
              marginBottom: 8,
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              fontWeight: 600,
            }}
          >
            First Segment
          </h4>
          <pre
            style={{
              background:
                "var(--yt-spec-general-background-a, rgba(0,0,0,0.3))",
              padding: 8,
              borderRadius: 6,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              fontSize: 11,
              color: "var(--yt-spec-text-secondary, #aaa)",
              fontFamily: "monospace",
            }}
          >
            {JSON.stringify(segments[0], null, 2)}
          </pre>
          <h4
            style={{
              color: "var(--yt-spec-text-primary, #f1f1f1)",
              marginBottom: 8,
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              fontWeight: 600,
            }}
          >
            Last Segment
          </h4>
          <pre
            style={{
              background:
                "var(--yt-spec-general-background-a, rgba(0,0,0,0.3))",
              padding: 8,
              borderRadius: 6,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              fontSize: 11,
              color: "var(--yt-spec-text-secondary, #aaa)",
              fontFamily: "monospace",
            }}
          >
            {JSON.stringify(segments[segments.length - 1], null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}
