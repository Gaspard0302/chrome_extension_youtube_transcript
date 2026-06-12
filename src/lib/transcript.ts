import type { TranscriptSegment } from "../types";

type CaptionTrack = {
  baseUrl: string;
  name?: { simpleText?: string };
  languageCode: string;
  kind?: string;
};

export type FetchDiagnostics = {
  steps: { label: string; status: "ok" | "warn" | "error"; detail?: string }[];
};

export type TranscriptAvailability = "available" | "none" | "unknown";

/** Thrown when YouTube positively reports the video has no captions. */
export class NoTranscriptError extends Error {
  readonly noTranscript = true;
}

// ---------------------------------------------------------------------------
// Player response extraction
// ---------------------------------------------------------------------------

interface PlayerResponseInfo {
  videoId: string | null;
  playability: string | null;
  tracks: CaptionTrack[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlayerResponseInfo(data: any): PlayerResponseInfo {
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return {
    videoId: data?.videoDetails?.videoId ?? null,
    playability: data?.playabilityStatus?.status ?? null,
    tracks: Array.isArray(tracks) ? (tracks as CaptionTrack[]) : [],
  };
}

/**
 * Extract a balanced JSON object starting at text[start] === "{".
 * Handles string literals and escape sequences.
 */
function extractJsonObject(text: string, start: number): string | null {
  if (text[start] !== "{") return null;
  let depth = 0,
    inStr = false,
    esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\" && inStr) {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Find `ytInitialPlayerResponse = {...}` in raw HTML/script text and parse it. */
function extractPlayerResponseFromText(text: string): PlayerResponseInfo | null {
  const re = /ytInitialPlayerResponse\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const braceIdx = m.index + m[0].length - 1;
    const raw = extractJsonObject(text, braceIdx);
    if (raw) {
      try {
        const info = toPlayerResponseInfo(JSON.parse(raw));
        if (info.videoId) return info;
      } catch {
        // malformed candidate — keep scanning
      }
    }
  }
  return null;
}

/**
 * Read the player response embedded in the page's <script> tags.
 *
 * CRITICAL: after a YouTube SPA navigation these script tags still hold the
 * FIRST loaded page's data. The result is only returned when its videoId
 * matches the video currently being watched; otherwise it is stale and using
 * it would yield the wrong video's captions (or a false "no captions").
 */
function readPlayerResponseFromDOM(expectedVideoId: string): PlayerResponseInfo | null {
  const jsonEl = document.querySelector<HTMLScriptElement>(
    'script[id="ytInitialPlayerResponse"]'
  );
  if (jsonEl?.textContent) {
    try {
      const info = toPlayerResponseInfo(JSON.parse(jsonEl.textContent));
      if (info.videoId === expectedVideoId) return info;
    } catch {
      // fall through to script scan
    }
  }

  for (const script of document.querySelectorAll<HTMLScriptElement>("script")) {
    const text = script.textContent ?? "";
    if (!text.includes("ytInitialPlayerResponse")) continue;
    const info = extractPlayerResponseFromText(text);
    if (info && info.videoId === expectedVideoId) return info;
  }
  return null;
}

/**
 * Re-fetch the watch page HTML for this exact videoId and parse its player
 * response. Unlike the DOM, this always reflects the current video, and the
 * same-origin request carries session cookies so the embedded timedtext URLs
 * are valid for this session.
 */
async function fetchWatchPagePlayerResponse(videoId: string): Promise<PlayerResponseInfo | null> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    credentials: "include",
    headers: { "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`watch page HTTP ${res.status}`);
  const html = await res.text();
  return extractPlayerResponseFromText(html);
}

/**
 * Ask the background service worker for ANDROID-client caption tracks.
 * The worker's fetch carries no YouTube cookies, so the request looks like a
 * genuine unauthenticated Android device — calling Innertube ANDROID from the
 * content script instead would attach session cookies and return 0 tracks.
 * ANDROID baseUrls also come without exp=xpe (no POT enforcement).
 */
async function fetchAndroidPlayerViaBackground(
  videoId: string
): Promise<{ tracks: CaptionTrack[]; playability: string | null } | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "GET_CAPTION_TRACKS", payload: { videoId } },
        (resp: { tracks?: CaptionTrack[]; playability?: string | null; error?: string } | undefined) => {
          if (chrome.runtime.lastError || !resp || resp.error) {
            resolve(null);
            return;
          }
          resolve({ tracks: resp.tracks ?? [], playability: resp.playability ?? null });
        }
      );
    } catch {
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Caption track resolution (multi-source, cached per video)
// ---------------------------------------------------------------------------

type TrackSource = "dom" | "android" | "watch-html" | "none";

interface ResolvedTracks {
  tracks: CaptionTrack[];
  source: TrackSource;
  /** True when a valid, playable player response positively had no captions. */
  noCaptions: boolean;
}

const trackCache = new Map<string, ResolvedTracks>();

function describeTracks(tracks: CaptionTrack[]): string {
  return tracks
    .map((t) => `${t.languageCode}${t.kind ? `[${t.kind}]` : ""}`)
    .join(", ");
}

async function resolveCaptionTracks(
  videoId: string,
  diag: FetchDiagnostics,
  fresh = false
): Promise<ResolvedTracks> {
  if (!fresh) {
    const cached = trackCache.get(videoId);
    if (cached && (cached.tracks.length > 0 || cached.noCaptions)) {
      diag.steps.push({
        label: "Caption tracks (cached)",
        status: cached.tracks.length > 0 ? "ok" : "warn",
        detail: `${cached.tracks.length} track(s) via ${cached.source}`,
      });
      return cached;
    }
  }

  let noCaptions = false;
  const remember = (r: ResolvedTracks): ResolvedTracks => {
    trackCache.set(videoId, r);
    return r;
  };

  // Source 1: player response already embedded in the page (free, validated
  // against videoId so stale SPA data is rejected).
  if (!fresh) {
    const dom = readPlayerResponseFromDOM(videoId);
    if (dom) {
      diag.steps.push({
        label: "DOM player response",
        status: dom.tracks.length > 0 ? "ok" : "warn",
        detail: `playability=${dom.playability}, ${dom.tracks.length} track(s): ${describeTracks(dom.tracks)}`,
      });
      if (dom.tracks.length > 0) {
        return remember({ tracks: dom.tracks, source: "dom", noCaptions: false });
      }
      if (dom.playability === "OK") noCaptions = true;
    } else {
      diag.steps.push({
        label: "DOM player response",
        status: "warn",
        detail: "Missing or belongs to a different video (stale SPA data)",
      });
    }
  }

  // Source 2: Innertube ANDROID via the background worker.
  const android = await fetchAndroidPlayerViaBackground(videoId);
  if (android) {
    diag.steps.push({
      label: "ANDROID Innertube (background)",
      status: android.tracks.length > 0 ? "ok" : "warn",
      detail: `playability=${android.playability}, ${android.tracks.length} track(s): ${describeTracks(android.tracks)}`,
    });
    if (android.tracks.length > 0) {
      return remember({ tracks: android.tracks, source: "android", noCaptions: false });
    }
    if (android.playability === "OK") noCaptions = true;
  } else {
    diag.steps.push({
      label: "ANDROID Innertube (background)",
      status: "warn",
      detail: "Background request failed or returned an error",
    });
  }

  // Source 3: re-fetch the watch page HTML for this exact video.
  try {
    const wp = await fetchWatchPagePlayerResponse(videoId);
    if (wp) {
      diag.steps.push({
        label: "Watch page HTML player response",
        status: wp.tracks.length > 0 ? "ok" : "warn",
        detail: `playability=${wp.playability}, ${wp.tracks.length} track(s): ${describeTracks(wp.tracks)}`,
      });
      if (wp.tracks.length > 0) {
        return remember({ tracks: wp.tracks, source: "watch-html", noCaptions: false });
      }
      if (wp.playability === "OK") noCaptions = true;
    } else {
      diag.steps.push({
        label: "Watch page HTML player response",
        status: "warn",
        detail: "Could not parse ytInitialPlayerResponse from HTML",
      });
    }
  } catch (err) {
    diag.steps.push({
      label: "Watch page HTML player response",
      status: "warn",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  const result: ResolvedTracks = { tracks: [], source: "none", noCaptions };
  // Only cache the empty result when it is definitive — transient failures
  // should be retried on the next attempt.
  if (noCaptions) remember(result);
  return result;
}

// ---------------------------------------------------------------------------
// Availability probe (used to decide whether to show the trigger button)
// ---------------------------------------------------------------------------

/**
 * Determine whether the video has a transcript at all.
 * "none" is only returned when a playable player response had no caption
 * tracks AND the get_transcript API also returned nothing — i.e. we are sure.
 * Network/parsing failures return "unknown" (caller should keep the UI).
 */
export async function checkTranscriptAvailability(
  videoId: string
): Promise<TranscriptAvailability> {
  try {
    const resolved = await resolveCaptionTracks(videoId, { steps: [] });
    if (resolved.tracks.length > 0) return "available";
    if (resolved.noCaptions) {
      const segs = await tryGetTranscriptApi(videoId, undefined, { steps: [] });
      return segs && segs.length > 0 ? "available" : "none";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Transcript fetching
// ---------------------------------------------------------------------------

function pickPreferredTrack(tracks: CaptionTrack[]): CaptionTrack {
  return (
    tracks.find((t) => t.languageCode === "en" && !t.kind) ??
    tracks.find((t) => t.languageCode === "en") ??
    tracks.find((t) => !t.kind) ??
    tracks[0]
  );
}

/**
 * Fetches the transcript for a YouTube video.
 *
 * Track resolution (cached per video): DOM player response (videoId-validated)
 * → ANDROID Innertube via background → fresh watch-page HTML.
 *
 * Transcript content, in order of reliability:
 *   1. Innertube get_transcript (the API YouTube's own transcript panel uses)
 *   2. timedtext URL of the preferred track (exp=xpe stripped, json3 → XML)
 *   3. freshly re-resolved track URLs (cached URLs may have expired)
 *
 * Throws NoTranscriptError when YouTube positively reports no captions.
 */
export async function fetchTranscript(
  videoId: string
): Promise<{ segments: TranscriptSegment[]; tracksLen: number; diagnostics: FetchDiagnostics }> {
  const diag: FetchDiagnostics = { steps: [] };

  const resolved = await resolveCaptionTracks(videoId, diag);

  if (resolved.tracks.length === 0) {
    // get_transcript needs only the videoId — always try it before giving up.
    const segs = await tryGetTranscriptApi(videoId, undefined, diag);
    if (segs && segs.length > 0) {
      return { segments: segs, tracksLen: 0, diagnostics: diag };
    }
    if (resolved.noCaptions) {
      throw Object.assign(
        new NoTranscriptError("This video does not have a transcript."),
        { diagnostics: diag }
      );
    }
    throw Object.assign(
      new Error("Could not reach YouTube's caption data. Check your connection and try again."),
      { diagnostics: diag }
    );
  }

  const preferred = pickPreferredTrack(resolved.tracks);
  diag.steps.push({
    label: "Select track",
    status: "ok",
    detail: `"${preferred.name?.simpleText ?? "unknown"}" (lang=${preferred.languageCode}, kind=${preferred.kind ?? "manual"}, source=${resolved.source})`,
  });

  // Path 1: get_transcript API
  const gtSegments = await tryGetTranscriptApi(videoId, preferred.languageCode, diag);
  if (gtSegments && gtSegments.length > 0) {
    return { segments: gtSegments, tracksLen: resolved.tracks.length, diagnostics: diag };
  }

  // Path 2: timedtext URL of the preferred track
  let lastErr: Error | null = null;
  try {
    const segments = await fetchTranscriptData(preferred.baseUrl, diag);
    return { segments, tracksLen: resolved.tracks.length, diagnostics: diag };
  } catch (err) {
    lastErr = err instanceof Error ? err : new Error(String(err));
    diag.steps.push({
      label: `Timedtext (${resolved.source}) failed`,
      status: "warn",
      detail: lastErr.message,
    });
  }

  // Path 3: resolve fresh tracks (cached URLs may have expired) and retry once
  trackCache.delete(videoId);
  try {
    const freshResolved = await resolveCaptionTracks(videoId, diag, true);
    if (freshResolved.tracks.length > 0) {
      const freshTrack = pickPreferredTrack(freshResolved.tracks);
      if (freshTrack.baseUrl !== preferred.baseUrl) {
        const segments = await fetchTranscriptData(freshTrack.baseUrl, diag);
        return { segments, tracksLen: freshResolved.tracks.length, diagnostics: diag };
      }
    }
  } catch (err) {
    lastErr = err instanceof Error ? err : new Error(String(err));
  }

  throw Object.assign(
    new Error(lastErr?.message ?? "Failed to fetch transcript."),
    { diagnostics: diag }
  );
}

// ---------------------------------------------------------------------------
// Innertube get_transcript
// ---------------------------------------------------------------------------

/**
 * Get the exact get_transcript `params` YouTube's own transcript panel would
 * use, by asking the /next endpoint for this video. Surviving protobuf format
 * changes is the point: hand-built params have broken other tools when
 * YouTube changed the encoding, while extracted params always match.
 */
async function getTranscriptParamsFromNext(videoId: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.youtube.com/youtubei/v1/next?prettyPrint=false", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: "2.20250530.01.00", hl: "en", gl: "US" } },
        videoId,
      }),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/"getTranscriptEndpoint"\s*:\s*\{\s*"params"\s*:\s*"([^"]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Build proto params for get_transcript: field 1 = videoId, optionally field 2 = lang.
 */
function buildGetTranscriptParams(videoId: string, lang?: string): string {
  const enc = new TextEncoder();
  const vb = enc.encode(videoId);
  const bytes: number[] = [0x0a, vb.length, ...vb];
  if (lang) {
    const lb = enc.encode(lang);
    bytes.push(0x12, lb.length, ...lb);
  }
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Call Innertube get_transcript. When a languageCode is given, tries it first
 * and then lets YouTube pick. Returns parsed segments, or null if the API
 * returned nothing useful.
 */
async function tryGetTranscriptApi(
  videoId: string,
  languageCode: string | undefined,
  diag: FetchDiagnostics
): Promise<TranscriptSegment[] | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parseSegments = (data: any): TranscriptSegment[] => {
    const transcriptRenderer =
      data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer;
    const segs: TranscriptSegment[] = [];

    // Shape 1 (current): transcriptSegmentListRenderer.initialSegments
    const initialSegments =
      transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
        ?.transcriptSegmentListRenderer?.initialSegments ??
      transcriptRenderer?.body?.transcriptSegmentListRenderer?.initialSegments ??
      [];
    for (const seg of initialSegments) {
      const r = seg?.transcriptSegmentRenderer;
      if (!r) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = (r.snippet?.runs ?? [])
        .map((run: any) => run?.text ?? "")
        .join("")
        .replace(/\n/g, " ")
        .trim();
      const start = parseInt(r.startMs ?? "0", 10) / 1000;
      const end = parseInt(r.endMs ?? "0", 10) / 1000;
      if (text) segs.push({ text, start, duration: Math.max(end - start, 0) });
    }
    if (segs.length > 0) return segs;

    // Shape 2 (legacy): transcriptBodyRenderer.cueGroups
    const cueGroups = transcriptRenderer?.body?.transcriptBodyRenderer?.cueGroups ?? [];
    for (const group of cueGroups) {
      for (const cue of group?.transcriptCueGroupRenderer?.cues ?? []) {
        const r = cue?.transcriptCueRenderer;
        const text = (r?.cue?.simpleText ?? "").trim();
        const start = parseInt(r?.startOffsetMs ?? "0", 10) / 1000;
        const duration = parseInt(r?.durationMs ?? "0", 10) / 1000;
        if (text) segs.push({ text, start, duration });
      }
    }
    return segs;
  };

  const attempts: { params: string; label: string }[] = [];

  // Attempt 0: params extracted from YouTube's own /next response — the most
  // reliable form, identical to what the native transcript panel sends.
  const extractedParams = await getTranscriptParamsFromNext(videoId);
  if (extractedParams) {
    attempts.push({ params: extractedParams, label: "panel params" });
  } else {
    diag.steps.push({ label: "get_transcript params from /next", status: "warn", detail: "No getTranscriptEndpoint found" });
  }

  if (languageCode) {
    attempts.push({ params: buildGetTranscriptParams(videoId, languageCode), label: `lang=${languageCode}` });
  }
  attempts.push({ params: buildGetTranscriptParams(videoId), label: "no-lang" });

  for (const { params, label } of attempts) {
    try {
      const res = await fetch(
        "https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: { client: { clientName: "WEB", clientVersion: "2.20250530.01.00", hl: "en", gl: "US" } },
            params,
            externalVideoId: videoId,
          }),
        }
      );
      if (!res.ok) {
        diag.steps.push({ label: `get_transcript (${label})`, status: "warn", detail: `HTTP ${res.status}` });
        continue;
      }
      const data = await res.json();
      const segs = parseSegments(data);
      if (segs.length > 0) {
        diag.steps.push({ label: `get_transcript (${label})`, status: "ok", detail: `${segs.length} cues` });
        return segs;
      }
      diag.steps.push({ label: `get_transcript (${label})`, status: "warn", detail: "0 cues in response" });
    } catch (err) {
      diag.steps.push({ label: `get_transcript (${label})`, status: "warn", detail: err instanceof Error ? err.message : String(err) });
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// timedtext fetching
// ---------------------------------------------------------------------------

/**
 * Fetch transcript data from a timedtext baseUrl, from the content script so
 * session cookies attach (required for WEB-client URLs).
 * Tries fmt=json3 first, then falls back to the default XML format.
 */
async function fetchTranscriptData(baseUrl: string, diag: FetchDiagnostics): Promise<TranscriptSegment[]> {
  // Strip exp=xpe / exp=xpv — these flags enable Proof-of-Origin Token (POT)
  // enforcement (server silently returns an empty 200 body without the token).
  // exp is not in sparams, so removing it does not invalidate the signature.
  const cleanBase = (() => {
    try {
      const u = new URL(baseUrl);
      u.searchParams.delete("exp");
      return u.toString();
    } catch {
      return baseUrl;
    }
  })();

  if (baseUrl !== cleanBase) {
    diag.steps.push({
      label: "Stripped exp param",
      status: "ok",
      detail: "Removed exp from timedtext URL to disable POT enforcement.",
    });
  }

  // Attempt 1: JSON3 format
  let json3Status = "skipped";
  try {
    const json3Url = cleanBase + "&fmt=json3";
    const res = await fetch(json3Url, { credentials: "include", headers: { "Accept-Language": "en-US,en;q=0.9" } });
    const contentLength = res.headers.get("content-length") ?? "unknown";
    const body = await res.text();
    const isHtmlError = body.trimStart().startsWith("<!DOCTYPE") || body.trimStart().startsWith("<html");
    diag.steps.push({
      label: "HTTP response (JSON3)",
      status: (body.length > 0 && !isHtmlError) ? "ok" : "error",
      detail: `status=${res.status}, content-length=${contentLength}, body=${body.length} bytes, preview: ${JSON.stringify(body.slice(0, 200))}`,
    });
    if (isHtmlError) throw new Error(`HTTP ${res.status}: server returned HTML error page`);
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
    const xmlRes = await fetch(cleanBase, { credentials: "include", headers: { "Accept-Language": "en-US,en;q=0.9" } });
    const xmlContentLength = xmlRes.headers.get("content-length") ?? "unknown";
    const xml = await xmlRes.text();
    const xmlIsHtmlError = xml.trimStart().startsWith("<!DOCTYPE") || xml.trimStart().startsWith("<html");
    diag.steps.push({
      label: "HTTP response (XML)",
      status: (xml.length > 0 && !xmlIsHtmlError) ? "ok" : "error",
      detail: `status=${xmlRes.status}, content-length=${xmlContentLength}, body=${xml.length} bytes, preview: ${JSON.stringify(xml.slice(0, 200))}`,
    });
    if (xmlIsHtmlError) throw new Error(`HTTP ${xmlRes.status}: server returned HTML error page`);
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

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Merge short caption segments into larger chunks for embedding and display.
 *
 * Boundaries are chosen to keep chunks semantically coherent:
 *  - once a chunk reaches targetWords, it is closed at the next sentence end
 *    (./!/?) or speech pause (gap >= 1.6s between segments) — auto-captions
 *    rarely have punctuation, so pauses are the main signal there;
 *  - chunks are force-closed at 2x targetWords or 90 seconds so a single
 *    timestamp never covers too much video.
 */
export function chunkTranscript(
  segments: TranscriptSegment[],
  targetWords = 80
): TranscriptSegment[] {
  const maxWords = targetWords * 2;
  const maxDurationSec = 90;
  const pauseGapSec = 1.6;

  const chunks: TranscriptSegment[] = [];
  let parts: string[] = [];
  let words = 0;
  let start = 0;
  let end = 0;

  const flush = () => {
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    if (text) chunks.push({ text, start, duration: Math.max(end - start, 0) });
    parts = [];
    words = 0;
  };

  for (const seg of segments) {
    const segWords = seg.text.split(/\s+/).filter(Boolean).length;

    if (parts.length > 0) {
      const gap = seg.start - end;
      const wouldRunLong =
        words + segWords > maxWords ||
        seg.start + Math.max(seg.duration, 0) - start > maxDurationSec;
      const atTarget = words >= targetWords;
      const sentenceEnded = /[.!?…]["')\]]?\s*$/.test(parts[parts.length - 1]);
      if (wouldRunLong || (atTarget && (sentenceEnded || gap >= pauseGapSec))) {
        flush();
      }
    }

    if (parts.length === 0) {
      start = seg.start;
      end = seg.start;
    }
    parts.push(seg.text);
    words += segWords;
    end = Math.max(end, seg.start + Math.max(seg.duration, 0));
  }
  flush();

  return chunks;
}

export interface YouTubeChapter {
  title: string;
  startTime: number; // seconds
}

/**
 * Extract creator-defined chapters from ytInitialData embedded in the page.
 * Returns null if no chapters are found (video has none, or parsing failed,
 * or — when expectedVideoId is given — the embedded data is stale SPA data
 * belonging to a previously watched video).
 */
export function getYouTubeChapters(expectedVideoId?: string): YouTubeChapter[] | null {
  for (const script of document.querySelectorAll<HTMLScriptElement>("script")) {
    const text = script.textContent ?? "";
    const marker = "var ytInitialData = ";
    const start = text.indexOf(marker);
    if (start === -1) continue;

    const jsonStart = start + marker.length;
    if (text[jsonStart] !== "{") continue;

    // Quick pre-check: skip the expensive JSON.parse if there is no chapter data.
    if (!text.includes('"markersMap"')) return null;

    const raw = extractJsonObject(text, jsonStart);
    if (!raw) continue;

    let data: unknown;
    try { data = JSON.parse(raw); } catch { continue; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;

    // After SPA navigation this data may belong to the previous video.
    if (expectedVideoId) {
      const dataVideoId = d?.currentVideoEndpoint?.watchEndpoint?.videoId;
      if (dataVideoId && dataVideoId !== expectedVideoId) return null;
    }

    const markersMap = d?.playerOverlays
      ?.playerOverlayRenderer
      ?.decoratedPlayerBarRenderer
      ?.decoratedPlayerBarRenderer
      ?.playerBar
      ?.multiMarkersPlayerBarRenderer
      ?.markersMap;

    if (Array.isArray(markersMap)) {
      for (const entry of markersMap) {
        const chapters = entry?.value?.chapters;
        if (!Array.isArray(chapters) || chapters.length === 0) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: YouTubeChapter[] = chapters.map((ch: any) => ({
          title: ch?.chapterRenderer?.title?.simpleText ?? "",
          startTime: (ch?.chapterRenderer?.timeRangeStartMillis ?? 0) / 1000,
        })).filter((ch: YouTubeChapter) => ch.title.length > 0);
        if (result.length > 0) return result;
      }
    }
  }
  return null;
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
 * Extract video ID from a YouTube URL (watch, shorts, live, embed, youtu.be).
 */
export function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:[?&]v=|\/shorts\/|\/live\/|\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}
