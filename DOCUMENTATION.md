# YouTube Transcript Extension — Documentation

## Overview

A Chrome extension that injects a "Transcript & AI" panel into YouTube's native UI, providing real-time transcript following, inline search, and AI chat grounded in the video's transcript.

---

## Architecture

### Extension Structure

```
src/
  content/
    index.tsx              — Content script entry: injection orchestration
    content.css            — Scoped styles (keyframes, scrollbar, mark highlight)
    components/
      Panel.tsx            — Root React component; owns all state; renders via portals
      TranscriptTab.tsx    — Real-time transcript with inline search
      ChatTab.tsx          — AI chat (Live Chat-style layout)
      DetailsTab.tsx       — Debug details and transcript stats
  lib/
    youtube-dom.ts         — Centralized YouTube DOM selectors and waitForDOMNodes helper
    transcript.ts          — Transcript fetching and chunking
    search.ts              — Exact and hybrid semantic search
    embeddings.ts          — Text embedding for semantic search
    providers.ts           — AI provider/model definitions
  types.ts                 — Shared TypeScript interfaces
```

---

## Key Architectural Decisions

### 1. Seamless DOM Integration (Session: Feb 2026)

**Decision:** Replaced the fixed full-height overlay sidebar with two React Portals injected directly into YouTube's layout.

**Previous approach:** A `position:fixed` host div attached to `document.body` with a shadow root containing the entire UI (toggle button + sliding sidebar). This overlaid the page and required manual z-index management.

**New approach:**
- **`#yt-transcript-trigger`** — a div prepended to YouTube's action bar (`#top-level-buttons-computed`). The "Transcript & AI" chip button is portaled here.
- **`#yt-transcript-panel`** — a div prepended to `#secondary-inner` (the recommended videos column). The full panel UI is portaled here. Falls back to inserting after `#description-inner` when the secondary column is absent (theater mode, smaller viewports).
- **`#yt-transcript-app-host`** — an invisible div (`position:absolute` off-screen) that serves only as the React root mount point. It holds no visible UI.

**Why portals over a direct mount:** A single React root preserves unified state (open/close, tab, loaded transcript, settings) while placing visible elements exactly where YouTube expects its own content. Portals allow React's event system and state to work normally across DOM boundaries.

### 2. AI Chat in Offscreen Document (Session: Feb 2026)

**Decision:** Chat streaming runs in the offscreen document, not in the background service worker.

**Reason:** The Vercel AI SDK (and some provider SDKs) reference `document` or other DOM globals. In the service worker those are undefined, leading to "document is not defined" at runtime. The offscreen document is a full extension page with `window` and `document`, so dynamic imports and the AI SDK run correctly.

**Flow:** Content script sends `CHAT_STREAM` to the background; background ensures the offscreen document exists, then forwards the payload as `OFFSCREEN_CHAT_STREAM`. The offscreen document runs `streamText`, sends `CHAT_CHUNK` messages for each token (content script receives them and updates the UI), and when done calls `sendResponse({ ok: true })` so the content script’s `sendMessage` promise resolves.

**Transcript context and timestamps:** The system prompt includes the full transcript. The model is instructed to cite timestamps in `[MM:SS]` or `[H:MM:SS]` for any reference to the video so the user can click to seek. The chat UI parses `[MM:SS]`, `[H:MM:SS]`, and parenthesized variants `(MM:SS)` / `(H:MM:SS)` and renders them as clickable buttons that call `jumpTo(seconds)` on the page’s `<video>` element.

---

### 3. SPA Navigation Handling

YouTube is a Single Page Application; navigating between videos does not reload the page.

**Flow:**
1. On page load: wait for `#player` to appear (via `MutationObserver`), then wait for the action bar and secondary column to appear (via `waitForDOMNodes` in `youtube-dom.ts`).
2. On `yt-navigate-finish`: call `cleanup()` (unmounts React root, removes all injected nodes, disconnects observers), then after 500ms restart from step 1.

**`youtube-dom.ts`:** Centralizes all YouTube DOM selectors so future YouTube DOM changes only require updating one file. Selectors use multiple fallbacks (e.g. `#top-level-buttons-computed` → `ytd-watch-metadata #top-level-buttons` → `#actions #top-level-buttons`).

### 4. Native Theme Synchronization (Session: Feb 2026)

**Decision:** All hardcoded hex colors removed; replaced with YouTube's native CSS custom properties.

**Rationale:** YouTube exposes its design tokens as CSS variables on `:root` (e.g. `--yt-spec-base-background`, `--yt-spec-text-primary`). By using these, the extension automatically inherits the user's current theme — dark mode, light mode, or any custom YouTube theme — without any extra logic.

**Key variables used:**

| Purpose | Variable | Fallback |
|---------|----------|----------|
| Panel background | `--yt-spec-brand-background-solid` | `#212121` |
| Page background | `--yt-spec-base-background` | `#0f0f0f` |
| Subtle background (cards/inputs) | `--yt-spec-general-background-a` | `rgba(0,0,0,0.3)` |
| Borders / dividers | `--yt-spec-10-percent-layer` | `rgba(255,255,255,0.1)` |
| Primary text | `--yt-spec-text-primary` | `#f1f1f1` |
| Secondary text | `--yt-spec-text-secondary` | `#aaa` |
| Brand / active accent | `--yt-spec-call-to-action-inverse-color` | `#ff0000` |
| Chip background | `--yt-spec-badge-chip-background` | `#272727` |

CSS custom properties always inherit through `all: initial`, so they work in both light DOM and shadow DOM contexts.

### 5. Shadow DOM Removal (Session: Feb 2026)

**Previous:** Shadow root on `#yt-transcript-root` for style isolation.

**New:** Light DOM portals. Shadow DOM was removed because:
- Style isolation is no longer needed — we *want* to inherit YouTube's CSS variables.
- Portaled elements naturally sit inside YouTube's DOM hierarchy and inherit variables without extra wiring.
- Inline styles handle all component-specific styling, preventing YouTube's global selectors from affecting our UI.

`content.css` no longer contains `@tailwind base` (which would inject a global CSS reset). It only contains: the `yt-transcript-spin` keyframe, scoped form element resets (`.yt-transcript-ext`), mark highlight colors, and thin scrollbar styles.

### 6. Inline Search in Transcript (Session: Feb 2026)

**Decision:** The "Search" tab was removed. Search is now a pinned filter bar at the top of the Transcript tab.

**Behavior:**
- Empty query → shows all segments with real-time playback sync and auto-scroll.
- Non-empty query → filters segments using `exactSearch` (or `hybridSearch` when semantic is enabled), displays results with `<mark>` highlights, and disables auto-scroll.
- 300ms debounce on input to avoid excessive search calls.
- Result count shown below the input; clear (×) button resets to unfiltered view.
- `TranscriptTab` now accepts `EmbeddedSegment[]` (instead of `TranscriptSegment[]`) and `semanticEnabled: boolean`. Panel always provides `embeddedOrRaw` which falls back to raw segments with empty embeddings when semantic search is disabled.

### 7. ChatTab — Live Chat Layout (Session: Feb 2026)

**Restyled** to resemble YouTube's Live Chat popup:
- Compact model/provider selector bar at top.
- Scrollable message list (flex-grow, `overflow-y: auto`, thin custom scrollbar).
- Sticky input area pinned to the bottom with `flex-shrink: 0`.
- Circular send button (consistent with YouTube's compact action buttons).
- Input and select borders use chip-style `border-radius: 20px` / `16px`.
- All colors use YouTube CSS variables with appropriate fallbacks.

---

## Component Reference

### `Panel.tsx`

Root component. Props: `{ triggerContainer: HTMLElement, panelContainer: HTMLElement }`.

Owns: `open`, `tab`, `loadState`, `loadProgress`, `rawSegments`, `embeddedSegments`, `settings`.

Renders two portals:
- `createPortal(<TriggerButton />, triggerContainer)` — chip button in action bar.
- `createPortal(<PanelContent />, panelContainer)` — card with header, chip tabs, and tab body.

### `TranscriptTab.tsx`

Props: `{ segments: EmbeddedSegment[], semanticEnabled: boolean }`.

Features: `timeupdate` sync for active segment highlight and auto-scroll; inline search bar with debounced filter; `dangerouslySetInnerHTML` for `<mark>` highlights; click-to-seek.

### `ChatTab.tsx`

Props: `{ segments, settings, onSettingsChange }`.

Features: streaming AI responses via `CHAT_STREAM` background message; `[MM:SS]` timestamp citations rendered as clickable seek buttons; Live Chat-style layout.

### `DetailsTab.tsx`

Props: `{ segments, errorDetails?, diagnostics? }`.

Features: pipeline step visualization with status colors; error trace display; transcript stats grid; first/last segment JSON preview.

---

## Selector Resilience

All YouTube DOM selectors are in `src/lib/youtube-dom.ts`. Each function tries selectors in priority order and returns the first match. Update this file if YouTube changes its DOM structure.

Current selector priority:

**Action bar:** `#top-level-buttons-computed` → `ytd-watch-metadata #top-level-buttons` → `#actions #top-level-buttons` → `#actions-inner`

**Secondary column:** `#secondary-inner` → `#secondary`

**Description (fallback):** `#description-inner` → `#description`

---

## Build

```bash
npm run dev    # development build with watch
npm run build  # production build → dist/
```

Load `dist/` as an unpacked extension in Chrome (`chrome://extensions` → Load unpacked).
