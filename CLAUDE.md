The role of this file is to describe common mistakes and confusion points that agents might encounter as they work in this project. If you ever encounter something in the project that surprises you, please alert the developer working with you and indicate that this is the case in the AgentMD file to help prevent future agents from having the same issue.

---

## YouTube timedtext URL: the `exp=xpe` / POT trap

**Symptom**: Fetching a timedtext URL returns HTTP 200 with a completely empty body (0 bytes, no error).

**Cause**: YouTube embeds `exp=xpe` in timedtext URLs served to browser clients. This flag tells the timedtext server to enforce a Proof-of-Origin Token (`pot=...` query parameter). Without the token, the server silently returns 200 with an empty body — even when the request carries valid session cookies.

**Fix**: Strip the `exp` parameter from the URL before fetching. `exp` is **not** included in `sparams` (the list of HMAC-signed parameters), so removing it does not invalidate the URL signature — it simply disables the POT check on the server side.

```ts
const u = new URL(baseUrl);
u.searchParams.delete('exp');
const cleanUrl = u.toString(); // safe to fetch
```

**Do NOT** route the timedtext fetch through the background service worker without the user's session cookies — the URL contains session-scoped tokens (`expire`, `signature`, etc.) that require the user's cookie context to be valid.

---

## Innertube ANDROID API: public API key is blocked; User-Agent is required

**Symptom**: Background `GET_CAPTION_TRACKS` handler returns HTTP 403.

**Cause 1**: The public API key (`AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`) appended as `?key=...` is rate-limited / blocked by YouTube. Remove it from the URL.

**Cause 2**: YouTube requires an Android `User-Agent` header for ANDROID client requests. Without it the request is rejected.

**Fix**: Remove `?key=...` from the Innertube URL and add:
```
User-Agent: com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip
X-YouTube-Client-Name: 3
X-YouTube-Client-Version: 19.09.37
```

---

## Innertube ANDROID from content script always returns 0 caption tracks

**Symptom**: Calling the Innertube `/youtubei/v1/player` endpoint directly from a content script returns a valid 200 response but `captionTracks` is an empty array.

**Cause**: Content scripts on `youtube.com` use `credentials: "same-origin"` by default, so the Innertube POST is sent **with the user's YouTube session cookies**. YouTube sees an authenticated-but-fake-ANDROID request and returns 0 captions (the ANDROID client with browser cookies looks suspicious / gets a different code path).

**Fix**: Always make the Innertube ANDROID call from the **background service worker** (`GET_CAPTION_TRACKS` message). The service worker's origin is `chrome-extension://...`, so its fetch requests carry **no** YouTube cookies — the request looks like a genuine unauthenticated Android device.

---

## Routing timedtext fetches through the background worker breaks them

**Symptom**: Transcripts that worked with a direct content-script fetch fail (empty body) after being rerouted through `FETCH_TRANSCRIPT_URL` (background).

**Cause**: The background service worker does **not** automatically carry the user's `youtube.com` session cookies. The timedtext URL's `signature` and `expire` parameters are tied to the user's session; without the matching cookies the server returns empty.

**Fix**: Keep timedtext URL fetches in the content script with `credentials: "include"`, and strip `exp=xpe` as described above instead of rerouting.

---

## Stale `ytInitialPlayerResponse` after SPA navigation

**Symptom**: After navigating video-to-video (or homepage → video) without a full page reload, the DOM `<script>` tags still contain the FIRST loaded page's `ytInitialPlayerResponse` / `ytInitialData`. Reading them yields the WRONG video's caption tracks/chapters, or a false "no captions".

**Fix**: Always validate `videoDetails.videoId` (player response) or `currentVideoEndpoint.watchEndpoint.videoId` (ytInitialData) against the current URL's video ID before trusting DOM-embedded data. When stale, re-fetch the watch page HTML for the current videoId (same-origin, `credentials: "include"`) and parse `ytInitialPlayerResponse` from it — see `fetchWatchPagePlayerResponse` in `src/lib/transcript.ts`.

---

## Content script match pattern must be `https://www.youtube.com/*`, NOT `/watch*`

**Symptom**: Extension button never appears when the user lands on the YouTube homepage and clicks into a video.

**Cause**: Chrome injects content scripts only on full-page loads matching the pattern. YouTube is an SPA — navigating homepage → video does not reload the page, so a `/watch*`-only match never injects the script.

**Fix**: Match all of `https://www.youtube.com/*` and gate mounting on `location.pathname === "/watch"` inside the script.

---

## Patching history.pushState in a content script is dead code

Content scripts run in an ISOLATED world. The page's SPA router calls the page-world `history.pushState` binding, which the content-script patch never sees. Use the `yt-navigate-finish` / `yt-page-data-updated` DOM events (these DO cross worlds) plus a URL poll fallback.

---

## get_transcript: extract `params` from /next; response has two shapes

- The hand-rolled protobuf `params` encoding has broken other tools when YouTube changed it. The robust source is YouTube's own data: POST `/youtubei/v1/next` (WEB context, with cookies) and regex out `"getTranscriptEndpoint":{"params":"..."}` — that is exactly what the native transcript panel sends. Hand-built params remain as fallback.
- The response can be the legacy `transcriptBodyRenderer.cueGroups` OR the current `transcriptSegmentListRenderer.initialSegments[]` (with `startMs`/`endMs`/`snippet.runs`). Parse both, or you'll report "0 cues" on videos that have transcripts.
- `get_transcript` needs only the videoId — always try it BEFORE concluding "no transcript" from missing caption tracks.

---

## June 2026 lockdown: anonymous Innertube is dead, get_transcript needs SAPISIDHASH

Verified by direct curl testing (2026-06):

- **All anonymous Innertube clients return `LOGIN_REQUIRED`** (ANDROID, ANDROID_VR, TVHTML5, WEB_EMBEDDED — even the anonymous watch page HTML). The cookie-less background ANDROID path is now a last resort that rarely works.
- **`get_transcript` returns 400 "Precondition check failed"** without the `Authorization: SAPISIDHASH <ts>_<sha1(ts SAPISID origin)>` header, even when session cookies are sent. SAPISID is a non-httpOnly cookie, readable via `document.cookie` from the content script. See `buildSapisidAuth` in `src/lib/transcript.ts`.
- **Timedtext URLs can now 404 after stripping `exp`** (it appears `exp` joined the signed params on some URLs). Don't assume the strip is safe — try both variants (stripped first, then original).
- **The bulletproof fallback is POT capture**: the page's player fetches timedtext with a valid Proof-of-Origin Token that extensions cannot mint. The background worker records `*/api/timedtext*` requests via `webRequest` (per tab, in `chrome.storage.session`); a MAIN-world bridge (`src/content/main-world.ts`, manifest `world: "MAIN"`) can nudge the player to load its captions module to trigger such a request, and exposes `#movie_player.getPlayerResponse()` (always current after SPA nav). NEVER modify a captured URL beyond swapping `fmt` via string surgery — re-serializing through `new URL()` re-encodes params and can break the signature.

---

## The reliable fallback under full lockdown: scrape the native transcript panel

By mid-2026 every network path can be blocked simultaneously: timedtext returns
empty 200 (POT) or 404 (exp now signed), `get_transcript` returns 400, and the
player's *captured* timedtext URL also returns empty (the POT is not replayable
from the captured URL — likely bound to the request's BotGuard context, and may
not even be a query param).

The path that still works: **let YouTube render its own transcript panel and
scrape the DOM.** YouTube performs the fetch with all its own tokens; we click
"Show transcript", wait for `ytd-transcript-segment-renderer` elements, read
`.segment-timestamp` + `.segment-text`, derive each duration from the next
segment's start, then restore the panel's prior open/closed state. See
`scrapeNativeTranscriptPanel` in `src/lib/transcript.ts`. Durations are
approximate (segment-level, no overlap) which is fine for chunking/citations.

Current fetch order: timedtext variants → get_transcript → passive captured POT
URL → **native panel scrape** → nudge+capture. The panel scrape is the one to
trust; the network paths are kept first only because they're silent and faster
when they happen to work.
