import React from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import Panel from "./components/Panel";
import "./content.css";
import { waitForDOMNodes, findActionBar, findSecondaryColumn, findDescriptionContainer } from "../lib/youtube-dom";
import type { PanelMode } from "../lib/youtube-dom";
import { getSegments } from "../lib/segment-store";
import { clearChapterMarkers } from "./chapter-markers";
import { exactSearch, hybridSearch } from "../lib/search";
import { formatTimestamp } from "../lib/transcript";
import type { SearchResult } from "../types";

let reactRoot: Root | null = null;
let appHost: HTMLElement | null = null;
let triggerContainer: HTMLElement | null = null;
let panelContainer: HTMLElement | null = null;
let domObserver: MutationObserver | null = null;
let playerObserver: MutationObserver | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let navDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function isWatchPage(): boolean {
  return location.pathname === "/watch" && location.search.includes("v=");
}

function cleanup() {
  clearChapterMarkers();
  reactRoot?.unmount();
  reactRoot = null;
  appHost?.remove();
  appHost = null;
  triggerContainer?.remove();
  triggerContainer = null;
  panelContainer?.remove();
  panelContainer = null;
  domObserver?.disconnect();
  domObserver = null;
  playerObserver?.disconnect();
  playerObserver = null;
  if (heartbeatInterval !== null) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

/**
 * Re-insert existing triggerContainer / panelContainer back into the page
 * after YouTube re-renders the action bar or secondary column (SPA nav).
 * Does NOT remount React — the existing React tree keeps its state.
 */
function reinjectContainers(actionBar: Element, panelNode: Element, panelMode: PanelMode) {
  if (triggerContainer && !actionBar.contains(triggerContainer)) {
    actionBar.prepend(triggerContainer);
  }
  if (panelContainer && !panelNode.contains(panelContainer)) {
    if (panelMode === "secondary") {
      (panelNode as HTMLElement).prepend(panelContainer);
    } else {
      panelNode.insertAdjacentElement("afterend", panelContainer);
    }
  }
}

function mountApp(
  actionBar: Element,
  panelNode: Element,
  panelMode: PanelMode
) {
  if (document.getElementById("yt-transcript-app-host")) return;

  // Inject trigger container into the action bar
  triggerContainer = document.createElement("div");
  triggerContainer.id = "yt-transcript-trigger";
  triggerContainer.style.cssText =
    "display:inline-flex;align-items:center;margin-right:8px;";
  actionBar.prepend(triggerContainer);

  // Inject panel container at the top of secondary column or after description
  panelContainer = document.createElement("div");
  panelContainer.id = "yt-transcript-panel";
  if (panelMode === "secondary") {
    (panelNode as HTMLElement).prepend(panelContainer);
  } else {
    panelNode.insertAdjacentElement("afterend", panelContainer);
  }

  // Invisible app host — only used as the React root mount point
  appHost = document.createElement("div");
  appHost.id = "yt-transcript-app-host";
  appHost.style.cssText =
    "position:absolute;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden;pointer-events:none;";
  document.body.appendChild(appHost);

  reactRoot = createRoot(appHost);
  reactRoot.render(
    <Panel
      triggerContainer={triggerContainer}
      panelContainer={panelContainer}
    />
  );

  // Watch for YouTube re-rendering the action bar (common on SPA nav).
  // On watch pages: re-inject the existing containers instead of full React remount
  // so the panel state (open, transcript, etc.) is preserved.
  if (heartbeatInterval !== null) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (!isWatchPage()) {
      cleanup();
      return;
    }
    if (triggerContainer && !document.contains(triggerContainer)) {
      const actionBar = findActionBar();
      const secondary = findSecondaryColumn();
      const description = findDescriptionContainer();
      const panelNode = secondary ?? description;
      const panelMode: PanelMode = secondary ? "secondary" : "description";
      if (actionBar && panelNode) {
        reinjectContainers(actionBar, panelNode, panelMode);
      } else {
        // DOM not ready yet — wait for it
        waitForDOMNodes(reinjectContainers);
      }
    }
  }, 1500);
}

function waitForDOMAndMount() {
  domObserver = waitForDOMNodes(mountApp);
}

function waitForPlayerThenDOM() {
  if (document.querySelector("#player")) {
    waitForDOMAndMount();
    return;
  }
  playerObserver = new MutationObserver(() => {
    if (document.querySelector("#player")) {
      playerObserver!.disconnect();
      playerObserver = null;
      waitForDOMAndMount();
    }
  });
  playerObserver.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// SEARCH_REQUEST — background asks content script to search the loaded segments.
// Used by the agentic chat tool (search_transcript).
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener(
  (
    msg: { type: string; payload?: { query: string } },
    _sender,
    sendResponse
  ) => {
    if (msg.type !== "SEARCH_REQUEST") return false;

    const query = msg.payload?.query ?? "";
    const segments = getSegments();

    if (!segments.length) {
      sendResponse({ results: "No transcript loaded yet." });
      return false;
    }

    function formatResults(results: SearchResult[]): string {
      if (!results.length) return "No matching segments found.";
      return results
        .map((r) => `[${formatTimestamp(r.segment.start)}] ${r.segment.text}`)
        .join("\n");
    }

    const hasEmbeddings = segments.some((s) => s.embedding.length > 0);
    if (hasEmbeddings) {
      hybridSearch(query, segments, 15)
        .then((results) => {
          sendResponse({ results: formatResults(results) });
        })
        .catch(() => {
          const fallback = exactSearch(query, segments).slice(0, 15);
          sendResponse({ results: formatResults(fallback) });
        });
      return true; // async
    }

    const results = exactSearch(query, segments).slice(0, 15);
    sendResponse({ results: formatResults(results) });
    return false;
  }
);

// The content script loads on all youtube.com pages (so it is present when
// the user SPA-navigates from the homepage to a video), but only starts
// observers on watch pages — handleNavigation mounts it on later navigations.
function boot() {
  if (isWatchPage()) waitForPlayerThenDOM();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

// Re-mount on YouTube SPA navigation
// YouTube fires yt-navigate-finish and/or yt-page-data-updated depending on nav type.
// Debounce so both events firing for the same navigation only trigger one remount.
let lastHandledUrl = location.href;

function handleNavigation() {
  if (navDebounceTimer !== null) clearTimeout(navDebounceTimer);
  navDebounceTimer = setTimeout(() => {
    navDebounceTimer = null;
    if (!isWatchPage()) {
      // Left video pages — tear everything down
      cleanup();
      return;
    }
    if (!document.getElementById("yt-transcript-app-host")) {
      // Not yet mounted (e.g. first load) — mount normally
      waitForPlayerThenDOM();
      return;
    }
    // Still on a watch page (video-to-video nav) — keep React mounted,
    // reset transcript state for the new video via custom event.
    document.dispatchEvent(new CustomEvent("yt-transcript-reset"));
  }, 200);
}

document.addEventListener("yt-navigate-finish", handleNavigation);
document.addEventListener("yt-page-data-updated", handleNavigation);
window.addEventListener("popstate", handleNavigation);

// NOTE: do NOT patch history.pushState here — content scripts run in an
// isolated world, so the page's SPA router calls its own binding and the
// patch would never fire. yt-navigate events + the URL poll below cover it.

// Fallback: poll for URL changes (handles edge cases)
setInterval(() => {
  if (location.href !== lastHandledUrl) {
    lastHandledUrl = location.href;
    handleNavigation();
  }
}, 500);
