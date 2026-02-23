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
