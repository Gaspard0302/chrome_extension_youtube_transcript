import type { TranscriptSegment } from "../types";

type CaptionTrack = {
  baseUrl: string;
  name: { simpleText: string };
  languageCode: string;
  kind?: string;
};

/**
 * Robustly extract the captionTracks array from the YouTube page HTML.
 * Uses bracket counting instead of regex to handle deeply nested JSON.
 */
function extractCaptionTracks(html: string): CaptionTrack[] | null {
  const key = '"captionTracks"';
  const keyIdx = html.indexOf(key);
  if (keyIdx === -1) return null;

  // Find the opening '[' after the key
  const bracketIdx = html.indexOf("[", keyIdx + key.length);
  if (bracketIdx === -1) return null;

  // Walk forward counting brackets to find the matching ']'
  let depth = 0;
  let end = bracketIdx;
  for (let i = bracketIdx; i < Math.min(html.length, bracketIdx + 200_000); i++) {
    const ch = html[i];
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  try {
    const tracks = JSON.parse(html.slice(bracketIdx, end + 1)) as CaptionTrack[];
    return Array.isArray(tracks) && tracks.length > 0 ? tracks : null;
  } catch {
    return null;
  }
}

/**
 * Fetches the transcript for a YouTube video by video ID.
 * Uses YouTube's internal timedtext API — no auth required.
 */
export async function fetchTranscript(
  videoId: string
): Promise<TranscriptSegment[]> {
  // Step 1: Fetch the video page to extract the timedtext URL
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    credentials: "include",
  });
  const html = await response.text();

  // Step 2: Find "captionTracks" and extract the JSON array using bracket counting
  // (regex is too fragile for deeply nested YouTube JSON)
  const tracks = extractCaptionTracks(html);
  if (!tracks) {
    throw new Error("No captions found for this video. It may not have a transcript.");
  }

  if (tracks.length === 0) {
    throw new Error("No caption tracks available for this video.");
  }

  // Prefer manual captions > auto-generated, then English
  const preferredTrack =
    tracks.find((t) => t.languageCode === "en" && !t.kind) ??
    tracks.find((t) => t.languageCode === "en") ??
    tracks[0];

  // Step 3: Fetch the actual transcript XML
  const transcriptUrl = preferredTrack.baseUrl + "&fmt=json3";
  const transcriptResponse = await fetch(transcriptUrl);

  if (!transcriptResponse.ok) {
    throw new Error("Failed to fetch transcript data.");
  }

  const data = await transcriptResponse.json() as {
    events: Array<{
      tStartMs: number;
      dDurationMs: number;
      segs?: Array<{ utf8: string }>;
    }>;
  };

  const segments: TranscriptSegment[] = [];

  for (const event of data.events) {
    if (!event.segs) continue;
    const text = event.segs
      .map((s) => s.utf8)
      .join("")
      .replace(/\n/g, " ")
      .trim();

    if (!text) continue;

    segments.push({
      text,
      start: event.tStartMs / 1000,
      duration: event.dDurationMs / 1000,
    });
  }

  return segments;
}

/**
 * Merge short segments into larger chunks for better embedding quality.
 * Target ~30 seconds or ~100 words per chunk.
 */
export function chunkTranscript(
  segments: TranscriptSegment[],
  targetWords = 80
): TranscriptSegment[] {
  const chunks: TranscriptSegment[] = [];
  let currentText = "";
  let currentStart = 0;
  let currentDuration = 0;

  for (const seg of segments) {
    const words = currentText.split(/\s+/).filter(Boolean).length;

    if (words >= targetWords && currentText.length > 0) {
      chunks.push({
        text: currentText.trim(),
        start: currentStart,
        duration: currentDuration,
      });
      currentText = seg.text;
      currentStart = seg.start;
      currentDuration = seg.duration;
    } else {
      if (!currentText) {
        currentStart = seg.start;
        currentDuration = 0;
      }
      currentText += (currentText ? " " : "") + seg.text;
      currentDuration = seg.start + seg.duration - currentStart;
    }
  }

  if (currentText.trim()) {
    chunks.push({
      text: currentText.trim(),
      start: currentStart,
      duration: currentDuration,
    });
  }

  return chunks;
}

/**
 * Format seconds into MM:SS or HH:MM:SS
 */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Extract video ID from a YouTube URL
 */
export function extractVideoId(url: string): string | null {
  const match = url.match(/[?&]v=([^&]+)/);
  return match ? match[1] : null;
}
