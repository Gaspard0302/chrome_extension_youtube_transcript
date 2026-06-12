/**
 * Renders AI-generated timeline chapters onto YouTube's native player UI,
 * mimicking native creator chapters:
 *
 *  - tick marks at chapter boundaries, injected into the progress bar's
 *    visual track (.ytp-progress-list) so they inherit the hover scale-up
 *  - the hovered chapter's title in a pill that rides above YouTube's own
 *    seek-preview tooltip
 *  - the current chapter's title appended to the time display (the spot
 *    where native chapters show "· Chapter name")
 *
 * Everything lives in the page DOM (not the extension's Shadow DOM) and uses
 * percentage positions, so theater mode / fullscreen / resize need no extra
 * handling. State is module-level so markers survive panel tab switches; a
 * keep-alive interval re-injects the DOM if YouTube re-renders the controls.
 * Markers are cleared on SPA navigation via the "yt-transcript-reset" event
 * (dispatched by src/content/index.tsx on video-to-video nav).
 *
 * The overlay is pointer-events:none throughout — clicks fall through to
 * YouTube's own seek handling, so click-to-seek works for free.
 */

export interface ChapterMarker {
  startTime: number;
  title: string;
}

const TICKS_ID = "ytta-chapter-ticks";
const HOVER_LABEL_ID = "ytta-chapter-hover-label";
const TIME_LABEL_ID = "ytta-chapter-time-label";

let chapters: ChapterMarker[] = [];
let keepAlive: ReturnType<typeof setInterval> | null = null;
let hookedBar: Element | null = null;
let hookedVideo: HTMLVideoElement | null = null;

function getPlayer(): HTMLElement | null {
  return document.getElementById("movie_player");
}

/** 0 when unknown / live (Infinity) — callers treat 0 as "not ready". */
function getDuration(video: HTMLVideoElement | null): number {
  const d = video?.duration ?? NaN;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

function chapterAt(time: number): ChapterMarker | null {
  let found: ChapterMarker | null = null;
  for (const ch of chapters) {
    if (ch.startTime <= time) found = ch;
    else break;
  }
  return found;
}

/** Bounding rect of an element, or null if it is hidden / zero-sized. */
function visibleRect(el: Element | null): DOMRect | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el.style.display === "none" || el.style.visibility === "hidden") return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

// ---------------------------------------------------------------------------
// Hover tooltip (chapter title pill above YouTube's seek preview)
// ---------------------------------------------------------------------------

function ensureHoverLabel(player: HTMLElement): HTMLElement {
  let label = document.getElementById(HOVER_LABEL_ID);
  if (!label || label.parentElement !== player) {
    label?.remove();
    label = document.createElement("div");
    label.id = HOVER_LABEL_ID;
    label.style.cssText =
      "position:absolute;z-index:80;pointer-events:none;display:none;" +
      "background:rgba(0,0,0,0.92);color:#fff;font-size:13px;font-weight:600;" +
      'font-family:"Roboto","Arial",sans-serif;padding:5px 10px;border-radius:6px;' +
      "border:1px solid rgba(255,255,255,0.25);box-shadow:0 2px 8px rgba(0,0,0,0.6);" +
      "white-space:nowrap;max-width:360px;overflow:hidden;text-overflow:ellipsis;" +
      "transform:translate(-50%,-100%);";
    player.appendChild(label);
  }
  return label;
}

function hideHoverLabel() {
  const label = document.getElementById(HOVER_LABEL_ID);
  if (label) label.style.display = "none";
}

function onBarMove(e: Event) {
  const me = e as MouseEvent;
  const player = getPlayer();
  const bar = hookedBar;
  if (!player || !bar || !chapters.length) return hideHoverLabel();
  if (player.classList.contains("ad-showing")) return hideHoverLabel();

  const video = player.querySelector<HTMLVideoElement>("video");
  const duration = getDuration(video);
  if (!duration) return hideHoverLabel();

  const barRect = bar.getBoundingClientRect();
  if (!barRect.width) return hideHoverLabel();
  const frac = Math.min(1, Math.max(0, (me.clientX - barRect.left) / barRect.width));
  const ch = chapterAt(frac * duration);
  if (!ch?.title) return hideHoverLabel();

  const label = ensureHoverLabel(player);
  label.textContent = ch.title;
  label.style.display = "block";

  // Ride above YouTube's seek preview. The preview is composed of several
  // elements (tooltip, storyboard thumb, fine-scrubbing "pull up" hint) whose
  // boxes extend above .ytp-tooltip itself — anchor above the TOP-MOST visible
  // one so the pill never overlaps YouTube's own text. Fall back to hovering
  // just above the bar at the cursor when no preview is visible.
  const playerRect = player.getBoundingClientRect();
  let x = me.clientX - playerRect.left;
  let topMost = barRect.top;
  const tooltip = visibleRect(player.querySelector(".ytp-tooltip"));
  if (tooltip) {
    x = tooltip.left + tooltip.width / 2 - playerRect.left;
    topMost = Math.min(topMost, tooltip.top);
  }
  for (const sel of [".ytp-tooltip-text-wrapper", ".ytp-fine-scrubbing"]) {
    const r = visibleRect(player.querySelector(sel));
    if (r) topMost = Math.min(topMost, r.top);
  }
  const y = topMost - playerRect.top - 10;
  // Keep the (center-anchored) pill inside the player horizontally
  const half = label.offsetWidth / 2;
  x = Math.min(playerRect.width - half - 4, Math.max(half + 4, x));
  label.style.left = `${x}px`;
  label.style.top = `${y}px`;
}

function onBarLeave() {
  hideHoverLabel();
}

// ---------------------------------------------------------------------------
// Current chapter title next to the time display
// ---------------------------------------------------------------------------

function ensureTimeLabel(player: HTMLElement): HTMLElement | null {
  const display = player.querySelector(".ytp-time-display");
  if (!display) return null;
  let span = document.getElementById(TIME_LABEL_ID);
  if (!span || span.parentElement !== display) {
    span?.remove();
    span = document.createElement("span");
    span.id = TIME_LABEL_ID;
    span.style.cssText =
      "color:#ddd;margin-left:4px;max-width:260px;overflow:hidden;" +
      "text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:bottom;";
    display.appendChild(span);
  }
  return span;
}

function onTimeUpdate() {
  const player = getPlayer();
  if (!player || !chapters.length) return;
  const span = ensureTimeLabel(player);
  if (!span) return;

  const video = hookedVideo ?? player.querySelector<HTMLVideoElement>("video");
  if (!video || !getDuration(video) || player.classList.contains("ad-showing")) {
    span.textContent = "";
    return;
  }
  const ch = chapterAt(video.currentTime);
  span.textContent = ch?.title ? ` · ${ch.title}` : "";
}

// ---------------------------------------------------------------------------
// Tick marks + lifecycle
// ---------------------------------------------------------------------------

function unhookBar() {
  if (hookedBar) {
    hookedBar.removeEventListener("mousemove", onBarMove);
    hookedBar.removeEventListener("mouseleave", onBarLeave);
    hookedBar = null;
  }
}

function unhookVideo() {
  if (hookedVideo) {
    hookedVideo.removeEventListener("timeupdate", onTimeUpdate);
    hookedVideo = null;
  }
}

function render() {
  const player = getPlayer();
  if (!player || !chapters.length) return;

  const bar = player.querySelector(".ytp-progress-bar");
  // .ytp-progress-list is the visual track that scales up on hover; the bar
  // itself is the (taller) hit area. Fall back to the bar if YT renames it.
  const track = bar?.querySelector(".ytp-progress-list") ?? bar;
  const video = player.querySelector<HTMLVideoElement>("video");
  const duration = getDuration(video);
  if (!bar || !track) return;

  let ticks = document.getElementById(TICKS_ID);
  if (!ticks || ticks.parentElement !== track) {
    ticks?.remove();
    ticks = document.createElement("div");
    ticks.id = TICKS_ID;
    ticks.style.cssText =
      "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:30;";
    track.appendChild(ticks);
  }

  // During ads video.duration belongs to the ad — hide and wait it out.
  if (player.classList.contains("ad-showing") || !duration) {
    ticks.style.display = "none";
    hideHoverLabel();
    return;
  }
  ticks.style.display = "";

  // Rebuild tick children only when the chapter set or duration changed
  const sig =
    `${duration.toFixed(1)}|` + chapters.map((c) => Math.round(c.startTime)).join(",");
  if (ticks.dataset.sig !== sig) {
    ticks.dataset.sig = sig;
    ticks.textContent = "";
    for (const ch of chapters) {
      if (ch.startTime <= 0) continue;
      const pct = (ch.startTime / duration) * 100;
      if (pct >= 100) continue;
      const tick = document.createElement("div");
      tick.style.cssText =
        "position:absolute;top:0;height:100%;width:2px;margin-left:-1px;" +
        `left:${pct}%;background:rgba(8,8,8,0.9);`;
      ticks.appendChild(tick);
    }
  }

  if (hookedBar !== bar) {
    unhookBar();
    hookedBar = bar;
    bar.addEventListener("mousemove", onBarMove);
    bar.addEventListener("mouseleave", onBarLeave);
  }
  if (video && hookedVideo !== video) {
    unhookVideo();
    hookedVideo = video;
    video.addEventListener("timeupdate", onTimeUpdate);
  }
  onTimeUpdate();
}

export function setChapterMarkers(markers: ChapterMarker[]) {
  chapters = [...markers].sort((a, b) => a.startTime - b.startTime);
  if (!chapters.length) {
    clearChapterMarkers();
    return;
  }
  // Keep-alive: re-injects after YouTube re-renders the controls, and retries
  // until video duration becomes available.
  if (!keepAlive) keepAlive = setInterval(render, 1500);
  render();
}

export function clearChapterMarkers() {
  chapters = [];
  if (keepAlive) {
    clearInterval(keepAlive);
    keepAlive = null;
  }
  unhookBar();
  unhookVideo();
  document.getElementById(TICKS_ID)?.remove();
  document.getElementById(HOVER_LABEL_ID)?.remove();
  document.getElementById(TIME_LABEL_ID)?.remove();
}

// Video-to-video SPA navigation: old chapters are wrong for the new video.
document.addEventListener("yt-transcript-reset", clearChapterMarkers);
