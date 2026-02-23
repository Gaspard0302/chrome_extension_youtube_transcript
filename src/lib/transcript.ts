import type { TranscriptSegment } from "../types";

type CaptionTrack = {
  baseUrl: string;
  name: { simpleText: string };
  languageCode: string;
  kind?: string;
};

/**
 * Extract the captionTracks JSON array from a raw script textContent string
 * using bracket counting. Reading .textContent from DOM nodes is CSP-safe.
 */
function extractCaptionTracks(source: string): CaptionTrack[] {
  const splittedHTML = source.split('"captions":');
  if (splittedHTML.length <= 1) return [];

  try {
    const rawJson = splittedHTML[1].split(',"videoDetails')[0].replace(/\n/g, "");
    const captions = JSON.parse(rawJson);
    const tracks = captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (Array.isArray(tracks) && tracks.length > 0) {
      return tracks as CaptionTrack[];
    }
  } catch (err) {
    // fall through
  }
  return [];
}

/**
 * Read caption tracks directly from DOM <script> tag textContent.
 * This avoids inline script injection which is blocked by YouTube's CSP.
 *
 * Stage 1: Try <script id="ytInitialPlayerResponse"> (newer YouTube)
 * Stage 2: Scan all <script> tags for one containing "captionTracks"
 */
function readCaptionTracksFromDOM(): CaptionTrack[] {
  // Stage 1: newer YouTube embeds the full player response as a JSON script tag
  const jsonEl = document.querySelector<HTMLScriptElement>(
    'script[id="ytInitialPlayerResponse"]'
  );
  if (jsonEl?.textContent) {
    try {
      const data = JSON.parse(jsonEl.textContent);
      const tracks =
        data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) return tracks;
    } catch {
      // fall through to Stage 2
    }
  }

  // Stage 2: scan all inline <script> tags for one containing captionTracks
  for (const script of document.querySelectorAll<HTMLScriptElement>("script")) {
    const text = script.textContent ?? "";
    if (text.includes('"captionTracks"')) {
      const tracks = extractCaptionTracks(text);
      if (tracks.length > 0) return tracks;
    }
  }

  throw new Error("No captions found. This video may not have a transcript.");
}

/**
 * Fetch caption tracks via the YouTube Innertube API using an ANDROID client.
 * ANDROID client responses do NOT include exp=xpe in baseUrl values, so they
 * work without Proof-of-Origin Tokens. This replaces the watch-page HTML scrape
 * which returned exp=xpe URLs that always yield empty bodies.
 */
async function getCaptionTracksViaPageFetch(videoId: string): Promise<CaptionTrack[]> {
  // Public Innertube API key (same key used by yt-dlp, youtube-transcript-api, etc.)
  const apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: { clientName: 'ANDROID', clientVersion: '20.10.38' },
        },
        videoId,
      }),
    }
  );
  if (!res.ok) throw new Error(`Innertube player returned ${res.status}`);
  const data = await res.json();
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks : [];
}

/**
 * Fetch a timedtext URL directly from the content script context.
 * Content scripts run on https://www.youtube.com, so this is a same-origin
 * request — YouTube session cookies attach automatically and the POT token
 * embedded in the baseUrl is valid for the current session.
 */
async function fetchFromMainWorld(url: string): Promise<string> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export type FetchDiagnostics = {
  steps: { label: string; status: "ok" | "warn" | "error"; detail?: string }[];
};

/**
 * Fetches the transcript for a YouTube video.
 * Primary: content script fetches the YouTube page HTML directly (same auth session).
 * Fallback: read ytInitialPlayerResponse from DOM <script> tags.
 *
 * Returns segments + step-by-step diagnostics for debugging.
 */
export async function fetchTranscript(
  videoId: string
): Promise<{ segments: TranscriptSegment[]; tracksLen: number; diagnostics: FetchDiagnostics }> {
  const diag: FetchDiagnostics = { steps: [] };

  // Step 1: Page fetch via content script directly
  let tracks: CaptionTrack[] = [];
  let bgError: string | null = null;
  try {
    tracks = await getCaptionTracksViaPageFetch(videoId);
    diag.steps.push({
      label: "Page fetch caption tracks",
      status: tracks.length > 0 ? "ok" : "warn",
      detail: tracks.length > 0
        ? `Found ${tracks.length} track(s): ${tracks.map(t => `${t.languageCode}${t.kind ? ` [${t.kind}]` : ""}`).join(", ")}`
        : "Returned 0 tracks",
    });
  } catch (err) {
    bgError = err instanceof Error ? err.message : String(err);
    diag.steps.push({
      label: "Page fetch caption tracks",
      status: "error",
      detail: bgError,
    });
  }

  // Step 2: DOM fallback if background returned nothing
  if (tracks.length === 0) {
    try {
      tracks = readCaptionTracksFromDOM();
      diag.steps.push({
        label: "DOM fallback caption tracks",
        status: tracks.length > 0 ? "ok" : "warn",
        detail: tracks.length > 0
          ? `Found ${tracks.length} track(s): ${tracks.map(t => `${t.languageCode}${t.kind ? ` [${t.kind}]` : ""}`).join(", ")}`
          : "Returned 0 tracks",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      diag.steps.push({
        label: "DOM fallback caption tracks",
        status: "error",
        detail: msg,
      });
      throw Object.assign(
        new Error(`Could not find any caption tracks.\nBackground: ${bgError ?? "n/a"}\nDOM: ${msg}`),
        { diagnostics: diag }
      );
    }
  }

  if (tracks.length === 0) {
    diag.steps.push({ label: "Select track", status: "error", detail: "No tracks available to select." });
    throw Object.assign(new Error("No caption tracks found in background fetch or DOM."), { diagnostics: diag });
  }

  // Step 3: Pick best track
  const preferredTrack =
    tracks.find((t) => t.languageCode === "en" && !t.kind) ??
    tracks.find((t) => t.languageCode === "en") ??
    tracks[0];
  diag.steps.push({
    label: "Select track",
    status: "ok",
    detail: `Using "${preferredTrack.name?.simpleText ?? "unknown"}" (lang=${preferredTrack.languageCode}, kind=${preferredTrack.kind ?? "manual"})`,
  });

  // Step 4: Fetch transcript data
  let segments: TranscriptSegment[];
  try {
    segments = await fetchTranscriptData(preferredTrack.baseUrl, diag);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // diagnostics already contain sub-steps from fetchTranscriptData
    throw Object.assign(new Error(msg), { diagnostics: diag });
  }

  return { segments, tracksLen: tracks.length, diagnostics: diag };
}

/**
 * Fetch transcript data from a baseUrl.
 * Tries fmt=json3 (compact JSON) first; if the body is empty or unparseable
 * falls back to the default XML format which YouTube always supports.
 * All fetches go through the background service worker to bypass CORS.
 */
async function fetchTranscriptData(baseUrl: string, diag: FetchDiagnostics): Promise<TranscriptSegment[]> {
  // Pre-flight: warn if URL contains exp=xpe (POT token enforcement)
  if (baseUrl.includes('exp=xpe') || baseUrl.includes('exp=xpv')) {
    diag.steps.push({
      label: "⚠ POT token required",
      status: "warn",
      detail: "URL contains exp=xpe — YouTube requires Proof-of-Origin Token for this track. The Innertube ANDROID client should have avoided this.",
    });
  }

  // Attempt 1: JSON3 format via background worker
  let json3Status = "skipped";
  try {
    const json3Url = baseUrl + "&fmt=json3";
    const res = await fetch(json3Url, { credentials: "include", headers: { "Accept-Language": "en-US,en;q=0.9" } });
    const contentLength = res.headers.get("content-length") ?? "unknown";
    const body = await res.text();
    diag.steps.push({
      label: "HTTP response (JSON3)",
      status: body.length > 0 ? "ok" : "error",
      detail: `status=${res.status}, content-length=${contentLength}, body=${body.length} bytes, preview: ${JSON.stringify(body.slice(0, 200))}`,
    });
    json3Status = `${body.length} bytes`;
    if (body) {
      const data = JSON.parse(body) as {
        events: Array<{
          tStartMs: number;
          dDurationMs: number;
          segs?: Array<{ utf8: string }>;
        }>;
      };
      const segments: TranscriptSegment[] = [];
      for (const event of data.events ?? []) {
        if (!event.segs) continue;
        const text = event.segs
          .map((s) => s.utf8)
          .join("")
          .replace(/\n/g, " ")
          .trim();
        if (text) {
          segments.push({
            text,
            start: event.tStartMs / 1000,
            duration: event.dDurationMs / 1000,
          });
        }
      }
      if (segments.length > 0) {
        diag.steps.push({ label: "Fetch JSON3 transcript", status: "ok", detail: `${segments.length} events, ${json3Status}` });
        return segments;
      }
      json3Status += " (0 events after filtering)";
    } else {
      json3Status = "empty body";
    }
  } catch (err) {
    json3Status = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
  diag.steps.push({ label: "Fetch JSON3 transcript", status: "warn", detail: json3Status + " — falling back to XML" });

  // Attempt 2: XML format
  let xmlStatus = "skipped";
  try {
    const xmlRes = await fetch(baseUrl, { credentials: "include", headers: { "Accept-Language": "en-US,en;q=0.9" } });
    const xmlContentLength = xmlRes.headers.get("content-length") ?? "unknown";
    const xml = await xmlRes.text();
    diag.steps.push({
      label: "HTTP response (XML)",
      status: xml.length > 0 ? "ok" : "error",
      detail: `status=${xmlRes.status}, content-length=${xmlContentLength}, body=${xml.length} bytes, preview: ${JSON.stringify(xml.slice(0, 200))}`,
    });
    xmlStatus = `${xml.length} bytes`;
    const segments = parseXmlTranscript(xml);
    diag.steps.push({ label: "Fetch XML transcript", status: "ok", detail: `${segments.length} segments, ${xmlStatus}` });
    return segments;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    diag.steps.push({ label: "Fetch XML transcript", status: "error", detail: `${xmlStatus} — ${msg}` });
    throw new Error(msg);
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n/g, " ")
    .trim();
}

/**
 * Parse YouTube's XML transcript formats:
 *
 * Format A (old): <transcript><text start="0.5" dur="2.5">Hello</text>...</transcript>
 *   - times in seconds as attributes "start" / "dur"
 *
 * Format B (timedtext format="3"):
 *   <timedtext format="3"><body><p t="240" d="4720"><s>Okay,</s><s t="400"> so</s></p>...
 *   - times in milliseconds as attributes "t" (start) / "d" (duration)
 *   - text split across <s> child elements
 */
function parseXmlTranscript(xml: string): TranscriptSegment[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const segments: TranscriptSegment[] = [];

  // Format B: timedtext format="3" — <p t="ms" d="ms"><s>text</s></p>
  const pNodes = doc.querySelectorAll("p");
  if (pNodes.length > 0) {
    for (const node of pNodes) {
      const tMs = parseFloat(node.getAttribute("t") ?? "0");
      const dMs = parseFloat(node.getAttribute("d") ?? "0");
      const sNodes = node.querySelectorAll("s");
      const raw = sNodes.length > 0
        ? Array.from(sNodes).map(s => s.textContent ?? "").join("")
        : (node.textContent ?? "");
      const text = decodeXmlEntities(raw);
      if (text) segments.push({ text, start: tMs / 1000, duration: dMs / 1000 });
    }
    if (segments.length > 0) return segments;
  }

  // Format A: <text start="s" dur="s">...</text>
  for (const node of doc.querySelectorAll("text")) {
    const start = parseFloat(node.getAttribute("start") ?? "0");
    const duration = parseFloat(node.getAttribute("dur") ?? "0");
    const text = decodeXmlEntities(node.textContent ?? "");
    if (text) segments.push({ text, start, duration });
  }

  if (segments.length === 0) {
    throw new Error(`XML parsed but yielded 0 segments. XML snippet: ${xml.slice(0, 300)}`);
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
