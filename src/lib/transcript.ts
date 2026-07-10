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
 * Ask the MAIN-world bridge (src/content/main-world.ts) for the live player's
 * getPlayerResponse(). This is always current for the video being watched —
 * the most reliable source after SPA navigation — and costs no network.
 */
function getPlayerResponseViaBridge(videoId: string): Promise<PlayerResponseInfo | null> {
  return new Promise((resolve) => {
    const reqId = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 1000);

    function onResult(e: Event) {
      try {
        const parsed = JSON.parse(String((e as CustomEvent).detail ?? "null"));
        if (parsed?.reqId !== reqId) return; // someone else's request
        cleanup();
        if (!parsed.pr) {
          resolve(null);
          return;
        }
        const info = toPlayerResponseInfo(parsed.pr);
        resolve(info.videoId === videoId ? info : null);
      } catch {
        cleanup();
        resolve(null);
      }
    }

    function cleanup() {
      clearTimeout(timer);
      document.removeEventListener("ytta-pr-result", onResult);
    }

    document.addEventListener("ytta-pr-result", onResult);
    document.dispatchEvent(new CustomEvent("ytta-get-pr", { detail: reqId }));
  });
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
): Promise<{ tracks: CaptionTrack[]; playability: string | null } | { error: string }> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "GET_CAPTION_TRACKS", payload: { videoId } },
        (resp: { tracks?: CaptionTrack[]; playability?: string | null; error?: string } | undefined) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message ?? "runtime error" });
            return;
          }
          if (!resp) {
            resolve({ error: "no response from background" });
            return;
          }
          if (resp.error) {
            resolve({ error: resp.error });
            return;
          }
          resolve({ tracks: resp.tracks ?? [], playability: resp.playability ?? null });
        }
      );
    } catch (err) {
      resolve({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

// ---------------------------------------------------------------------------
// Caption track resolution (multi-source, cached per video)
// ---------------------------------------------------------------------------

type TrackSource = "dom" | "player" | "android" | "watch-html" | "none";

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

  // Source 2: the live player's own player response via the MAIN-world bridge
  // (always current, validated, free).
  const live = await getPlayerResponseViaBridge(videoId);
  if (live) {
    diag.steps.push({
      label: "Live player response (bridge)",
      status: live.tracks.length > 0 ? "ok" : "warn",
      detail: `playability=${live.playability}, ${live.tracks.length} track(s): ${describeTracks(live.tracks)}`,
    });
    if (live.tracks.length > 0) {
      return remember({ tracks: live.tracks, source: "player", noCaptions: false });
    }
    if (live.playability === "OK") noCaptions = true;
  } else {
    diag.steps.push({
      label: "Live player response (bridge)",
      status: "warn",
      detail: "Bridge unavailable or player response is for a different video",
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

  // Source 4 (last resort): Innertube ANDROID via the background worker.
  // YouTube now answers LOGIN_REQUIRED to anonymous clients on many networks,
  // so this rarely succeeds anymore — but it costs nothing to try.
  const android = await fetchAndroidPlayerViaBackground(videoId);
  if ("error" in android) {
    diag.steps.push({
      label: "ANDROID Innertube (background)",
      status: "warn",
      detail: android.error,
    });
  } else {
    diag.steps.push({
      label: "ANDROID Innertube (background)",
      status: android.tracks.length > 0 ? "ok" : "warn",
      detail: `playability=${android.playability}, ${android.tracks.length} track(s): ${describeTracks(android.tracks)}`,
    });
    if (android.tracks.length > 0) {
      return remember({ tracks: android.tracks, source: "android", noCaptions: false });
    }
    if (android.playability === "OK") noCaptions = true;
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
// Native transcript panel scrape (most reliable — YouTube does the fetch)
// ---------------------------------------------------------------------------

function parseTimestampToSeconds(ts: string): number {
  const parts = ts.trim().split(":").map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

function waitFor<T>(get: () => T | null, timeoutMs: number, intervalMs = 150): Promise<T | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const v = get();
      if (v) {
        resolve(v);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function readRenderedTranscriptSegments(): TranscriptSegment[] {
  const nodes = document.querySelectorAll("ytd-transcript-segment-renderer");
  const segments: TranscriptSegment[] = [];
  for (const node of nodes) {
    const tsEl = node.querySelector(".segment-timestamp, [class*='timestamp']");
    const textEl = node.querySelector(".segment-text, yt-formatted-string.segment-text, [class*='segment-text']");
    const ts = tsEl?.textContent?.trim() ?? "";
    const text = textEl?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (text) {
      const start = parseTimestampToSeconds(ts);
      segments.push({ text, start, duration: 0 });
    }
  }
  // Derive each segment's duration from the next segment's start.
  for (let i = 0; i < segments.length - 1; i++) {
    segments[i].duration = Math.max(segments[i + 1].start - segments[i].start, 0);
  }
  return segments;
}

function findTranscriptButton(): HTMLElement | null {
  // 1) The dedicated transcript section in the (possibly collapsed) description
  const sectionBtn = document.querySelector<HTMLElement>(
    "ytd-video-description-transcript-section-renderer button, " +
      "ytd-video-description-transcript-section-renderer ytd-button-renderer button"
  );
  if (sectionBtn) return sectionBtn;

  // 2) Any button labelled "transcript" (aria-label or text)
  const candidates = document.querySelectorAll<HTMLElement>(
    "button, tp-yt-paper-button, yt-button-shape button, a"
  );
  for (const el of candidates) {
    const label = (el.getAttribute("aria-label") ?? "").toLowerCase();
    const text = (el.textContent ?? "").toLowerCase();
    if (label.includes("transcript") || /show transcript/.test(text)) return el;
  }
  return null;
}

const TRANSCRIPT_PANEL_SELECTOR =
  'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]';

function getTranscriptPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>(TRANSCRIPT_PANEL_SELECTOR);
}

function isTranscriptPanelOpen(): boolean {
  return !!document.querySelector(
    `${TRANSCRIPT_PANEL_SELECTOR}[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]`
  );
}

/**
 * Close the transcript engagement panel and confirm it actually closed,
 * trying several mechanisms YouTube has used across versions.
 */
async function closeTranscriptPanel(): Promise<void> {
  for (let attempt = 0; attempt < 4 && isTranscriptPanelOpen(); attempt++) {
    const panel = getTranscriptPanel();
    // The header's only button is the X (close); fall back to labelled buttons.
    const closeBtn =
      panel?.querySelector<HTMLElement>(
        "ytd-engagement-panel-title-header-renderer #visibility-button button, " +
          "ytd-engagement-panel-title-header-renderer button[aria-label]"
      ) ??
      panel?.querySelector<HTMLElement>(
        'button[aria-label*="Close" i], tp-yt-paper-icon-button[aria-label*="Close" i]'
      );
    closeBtn?.click();
    await new Promise((r) => setTimeout(r, 150));
  }
  // Last resort: ask YouTube to hide it via its own action event.
  if (isTranscriptPanelOpen()) {
    const panel = getTranscriptPanel();
    if (panel) panel.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN");
  }
}

/**
 * Scrape the transcript from YouTube's own native transcript panel. This is
 * the most robust path under POT/auth lockdown: YouTube fetches the transcript
 * with all its own tokens and renders it into the DOM; we just read it.
 *
 * The panel is driven off-screen so the user never sees it, then restored to
 * its prior open/closed state. Returns null if the panel never populates.
 */
async function scrapeNativeTranscriptPanel(diag: FetchDiagnostics): Promise<TranscriptSegment[] | null> {
  // Already open (user opened it themselves) — just read it, touch nothing.
  let existing = readRenderedTranscriptSegments();
  if (existing.length > 0) {
    diag.steps.push({ label: "Native transcript panel", status: "ok", detail: `${existing.length} segments (already open)` });
    return existing;
  }

  const panelWasOpen = isTranscriptPanelOpen();
  // NOTE: do NOT hide the panel off-screen — YouTube gates the transcript
  // fetch on the panel becoming actually visible, so hiding it makes the rows
  // never populate. We accept a brief flash and close it again immediately.

  try {
    const btn = findTranscriptButton();
    if (!btn) {
      // Some layouts need the description expanded first to reveal the button.
      document.querySelector<HTMLElement>("tp-yt-paper-button#expand, #expand")?.click();
      const retryBtn = await waitFor(() => findTranscriptButton(), 1500);
      if (!retryBtn) {
        diag.steps.push({ label: "Native transcript panel", status: "warn", detail: "Transcript button not found in page" });
        return null;
      }
      retryBtn.click();
    } else {
      btn.click();
    }

    const ready = await waitFor(() => {
      const segs = readRenderedTranscriptSegments();
      return segs.length > 0 ? segs : null;
    }, 6000);

    if (!ready) {
      diag.steps.push({ label: "Native transcript panel", status: "warn", detail: "Panel opened but no segments rendered in time" });
      return null;
    }

    existing = ready;
    diag.steps.push({ label: "Native transcript panel", status: "ok", detail: `${existing.length} segments scraped from DOM` });
    return existing;
  } finally {
    // Restore the page to how we found it: close the panel if we opened it.
    if (!panelWasOpen) {
      try {
        await closeTranscriptPanel();
      } catch {
        // non-fatal
      }
    }
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
    // Track resolution failed, but the video may still have captions:
    // get_transcript needs only the videoId, and the player's own POT URL
    // works regardless of what we could resolve.
    const segs =
      (await tryGetTranscriptApi(videoId, undefined, diag)) ??
      (await tryCapturedTimedtext(videoId, undefined, diag, !resolved.noCaptions));
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

  let lastErr: Error | null = null;

  // Path 1: timedtext URL of the preferred track (several URL variants).
  // Fast and silent — works when POT is not enforced for this URL.
  try {
    const segments = await fetchTranscriptData(preferred.baseUrl, diag);
    return { segments, tracksLen: resolved.tracks.length, diagnostics: diag };
  } catch (err) {
    lastErr = err instanceof Error ? err : new Error(String(err));
  }

  // Path 2: get_transcript API (with SAPISIDHASH auth) — silent.
  const gtSegments = await tryGetTranscriptApi(videoId, preferred.languageCode, diag);
  if (gtSegments && gtSegments.length > 0) {
    return { segments: gtSegments, tracksLen: resolved.tracks.length, diagnostics: diag };
  }

  // Path 3: a timedtext URL the player already fetched itself (passive — no
  // UI side effects; present when the user watches with captions on).
  let segments = await tryCapturedTimedtext(videoId, preferred.languageCode, diag, false);
  if (segments) {
    return { segments, tracksLen: resolved.tracks.length, diagnostics: diag };
  }

  // Path 4: enable captions (CC button) so the player issues a POT-authorized
  // timedtext request, capture it, and re-fetch. This is the reliable path
  // under the 2026 POT lockdown — it replicates the user turning on CC, which
  // is the only thing that makes YouTube mint a usable token. Captions are
  // toggled back off afterwards.
  segments = await tryCapturedTimedtext(videoId, preferred.languageCode, diag, true);
  if (segments) {
    return { segments, tracksLen: resolved.tracks.length, diagnostics: diag };
  }

  // Path 5 (last resort): scrape YouTube's own native transcript panel.
  segments = await scrapeNativeTranscriptPanel(diag);
  if (segments && segments.length > 0) {
    return { segments, tracksLen: resolved.tracks.length, diagnostics: diag };
  }

  throw Object.assign(
    new Error(lastErr?.message ?? "Failed to fetch transcript."),
    { diagnostics: diag }
  );
}

// ---------------------------------------------------------------------------
// Innertube get_transcript
// ---------------------------------------------------------------------------

function getCookieValue(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Compute the SAPISIDHASH Authorization header YouTube's own page sends with
 * Innertube requests. Cookies alone are no longer enough: without this header
 * a logged-in session gets 400 "Precondition check failed" from endpoints
 * like get_transcript. SAPISID is a non-httpOnly cookie, so the content
 * script can read it. Returns null when logged out (header then omitted).
 */
async function buildSapisidAuth(): Promise<string | null> {
  const sapisid = getCookieValue("SAPISID") ?? getCookieValue("__Secure-3PAPISID");
  if (!sapisid) return null;
  const ts = Math.floor(Date.now() / 1000);
  const data = new TextEncoder().encode(`${ts} ${sapisid} https://www.youtube.com`);
  const digest = await crypto.subtle.digest("SHA-1", data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `SAPISIDHASH ${ts}_${hex}`;
}

async function innertubeWebHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Youtube-Client-Name": "1",
    "X-Youtube-Client-Version": "2.20250530.01.00",
    "X-Origin": "https://www.youtube.com",
  };
  const auth = await buildSapisidAuth();
  if (auth) headers["Authorization"] = auth;
  return headers;
}

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
      headers: await innertubeWebHeaders(),
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: "2.20250530.01.00", hl: "en", gl: "US" } },
        videoId,
      }),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/"getTranscriptEndpoint"\s*:\s*\{\s*"params"\s*:\s*"([^"]+)"/);
    if (!m) return null;
    // The raw JSON text may contain escapes like = — decode them.
    try {
      return JSON.parse(`"${m[1]}"`) as string;
    } catch {
      return m[1];
    }
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
          headers: await innertubeWebHeaders(),
          body: JSON.stringify({
            context: { client: { clientName: "WEB", clientVersion: "2.20250530.01.00", hl: "en", gl: "US" } },
            params,
          }),
        }
      );
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        diag.steps.push({
          label: `get_transcript (${label})`,
          status: "warn",
          detail: `HTTP ${res.status}: ${errBody.slice(0, 160)}`,
        });
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
 * Remove the exp parameter via string surgery. Round-tripping through the URL
 * class re-encodes every query param, which can invalidate the URL signature —
 * the URL string must otherwise stay byte-identical.
 */
function stripExpParam(url: string): string {
  return url.replace(/([?&])exp=[^&]*(&?)/, (_m, pre, post) => (post ? pre : ""));
}

/** Set or replace the fmt parameter without re-encoding the rest of the URL. */
function withFormat(url: string, fmt: string): string {
  if (/[?&]fmt=/.test(url)) return url.replace(/([?&])fmt=[^&]*/, `$1fmt=${fmt}`);
  return url + (url.includes("?") ? "&" : "?") + "fmt=" + fmt;
}

function parseJson3Transcript(body: string): TranscriptSegment[] {
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
  if (segments.length === 0) throw new Error("JSON3 parsed but yielded 0 segments");
  return segments;
}

/** Fetch one timedtext URL (with cookies) and parse whatever format comes back. */
async function fetchAndParseTimedtext(
  url: string,
  diag: FetchDiagnostics,
  label: string
): Promise<TranscriptSegment[]> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Accept-Language": "en-US,en;q=0.9" },
  });
  const body = await res.text();
  const trimmed = body.trimStart();
  const isHtmlError = trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html");
  const ok = res.ok && body.length > 0 && !isHtmlError;
  diag.steps.push({
    label: `Timedtext (${label})`,
    status: ok ? "ok" : "warn",
    detail: `status=${res.status}, body=${body.length} bytes${ok ? "" : `, preview: ${JSON.stringify(body.slice(0, 120))}`}`,
  });
  if (!res.ok || isHtmlError) throw new Error(`HTTP ${res.status}${isHtmlError ? " (HTML error page)" : ""}`);
  if (!body) throw new Error("empty 200 body (POT token required)");

  if (trimmed.startsWith("{")) return parseJson3Transcript(body);
  return parseXmlTranscript(body);
}

/**
 * Fetch a caption track's transcript, trying URL variants in order:
 *   1. exp stripped, fmt=json3   (historically the working combination)
 *   2. original URL, fmt=json3   (in case exp became signature-protected)
 *   3. exp stripped, default format
 *   4. original URL, default format
 */
async function fetchTranscriptData(baseUrl: string, diag: FetchDiagnostics): Promise<TranscriptSegment[]> {
  const stripped = stripExpParam(baseUrl);
  const candidates: { url: string; label: string }[] =
    stripped !== baseUrl
      ? [
          { url: withFormat(stripped, "json3"), label: "exp-stripped json3" },
          { url: withFormat(baseUrl, "json3"), label: "original json3" },
          { url: stripped, label: "exp-stripped default" },
          { url: baseUrl, label: "original default" },
        ]
      : [
          { url: withFormat(baseUrl, "json3"), label: "json3" },
          { url: baseUrl, label: "default" },
        ];

  let lastErr: Error | null = null;
  for (const { url, label } of candidates) {
    try {
      return await fetchAndParseTimedtext(url, diag, label);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error("timedtext fetch failed");
}

// ---------------------------------------------------------------------------
// POT capture — re-use the player's own timedtext URL
// ---------------------------------------------------------------------------

function getCapturedTimedtextUrl(
  videoId: string
): Promise<{ url: string | null; hasPot: boolean }> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "GET_CAPTURED_TIMEDTEXT", payload: { videoId } },
        (resp: { url?: string | null; hasPot?: boolean } | undefined) => {
          if (chrome.runtime.lastError || !resp) {
            resolve({ url: null, hasPot: false });
            return;
          }
          resolve({ url: resp.url ?? null, hasPot: !!resp.hasPot });
        }
      );
    } catch {
      resolve({ url: null, hasPot: false });
    }
  });
}

/** The CC / subtitles toggle in the player controls (lives in the page DOM). */
function getCaptionToggle(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ytp-subtitles-button.ytp-button, .ytp-subtitles-button");
}

/**
 * Enable captions exactly the way the user does — by clicking the CC button.
 * This makes the player issue a timedtext request carrying a valid POT, which
 * the background worker captures. Returns whether captions were already on so
 * the caller can restore the prior state. The JS-API nudge is fired too as a
 * belt-and-braces fallback.
 */
function turnCaptionsOn(lang: string | undefined): { toggled: boolean; available: boolean } {
  document.dispatchEvent(
    new CustomEvent("ytta-nudge-captions", { detail: JSON.stringify({ lang: lang ?? "en" }) })
  );
  const btn = getCaptionToggle();
  if (!btn) return { toggled: false, available: false };
  const wasOn = btn.getAttribute("aria-pressed") === "true";
  if (!wasOn) btn.click();
  return { toggled: !wasOn, available: true };
}

function turnCaptionsOff() {
  const btn = getCaptionToggle();
  if (btn && btn.getAttribute("aria-pressed") === "true") btn.click();
}

/**
 * The page's player fetches timedtext with a valid Proof-of-Origin Token that
 * extensions cannot mint themselves; the background worker records those
 * requests (webRequest) and we re-fetch the captured URL with the user's
 * cookies. When allowNudge is set and we don't yet have a POT-bearing URL, we
 * turn captions on (CC button) to provoke one, then restore the prior state.
 */
async function tryCapturedTimedtext(
  videoId: string,
  lang: string | undefined,
  diag: FetchDiagnostics,
  allowNudge: boolean
): Promise<TranscriptSegment[] | null> {
  let captured = await getCapturedTimedtextUrl(videoId);

  // Nudge unless we already have a usable (POT-bearing) URL — a previously
  // captured POT-less URL is not good enough and must not suppress the nudge.
  if (allowNudge && !captured.hasPot) {
    diag.steps.push({
      label: "Nudge player captions",
      status: "warn",
      detail: "Enabling captions (CC button) so the player issues a POT-authorized request",
    });
    const { toggled, available } = turnCaptionsOn(lang);
    if (!available) {
      diag.steps.push({ label: "Nudge player captions", status: "warn", detail: "CC button not found in player" });
    }
    // Wait for a POT-bearing URL to be captured (fall back to any URL).
    for (let i = 0; i < 15 && !captured.hasPot; i++) {
      await new Promise((r) => setTimeout(r, 400));
      captured = await getCapturedTimedtextUrl(videoId);
    }
    if (toggled) turnCaptionsOff(); // restore prior caption state
  }

  const url = captured.url;
  if (!url) {
    diag.steps.push({
      label: "Captured timedtext URL",
      status: "warn",
      detail: allowNudge ? "No player timedtext request captured after nudge" : "Nothing captured yet",
    });
    return null;
  }

  diag.steps.push({
    label: "Captured timedtext URL",
    status: "ok",
    detail: `Re-using player's request URL (pot token ${captured.hasPot ? "present" : "ABSENT — likely won't work"})`,
  });
  try {
    return await fetchAndParseTimedtext(withFormat(url, "json3"), diag, "captured json3");
  } catch {
    // fmt swap may not be allowed — retry the captured URL byte-identical
  }
  try {
    return await fetchAndParseTimedtext(url, diag, "captured verbatim");
  } catch (err) {
    diag.steps.push({
      label: "Captured URL fetch failed",
      status: "warn",
      detail: err instanceof Error ? err.message : String(err),
    });
    return null;
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

/**
 * Group raw caption lines into sentence-level display units, each keeping the
 * timestamp of its first word. This is what the on-screen transcript renders —
 * far finer than chunkTranscript (which targets embedding quality) so every
 * sentence gets its own clickable timestamp, matching YouTube's own panel.
 *
 * A unit closes at the first of: a sentence end (./!/?/…), a clear speech
 * pause once it has a few words, or the size caps (so auto-captions, which
 * have no punctuation, still break into short readable lines).
 */
export function buildDisplaySegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const maxWords = 22;
  const maxDurationSec = 10;
  const pauseGapSec = 1.0;
  const minWordsForPauseBreak = 6;

  const out: TranscriptSegment[] = [];
  let parts: string[] = [];
  let words = 0;
  let start = 0;
  let end = 0;

  const flush = () => {
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    if (text) out.push({ text, start, duration: Math.max(end - start, 0) });
    parts = [];
    words = 0;
  };

  for (const seg of segments) {
    const segWords = seg.text.split(/\s+/).filter(Boolean).length;

    if (parts.length > 0) {
      const gap = seg.start - end;
      const sentenceEnded = /[.!?…]["')\]]?\s*$/.test(parts[parts.length - 1]);
      const tooLong =
        words + segWords > maxWords ||
        seg.start + Math.max(seg.duration, 0) - start > maxDurationSec;
      if (sentenceEnded || tooLong || (words >= minWordsForPauseBreak && gap >= pauseGapSec)) {
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

  return out;
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
