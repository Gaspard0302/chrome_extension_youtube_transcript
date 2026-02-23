import React from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import Panel from "./components/Panel";
import "./content.css";
import { waitForDOMNodes } from "../lib/youtube-dom";
import type { PanelMode } from "../lib/youtube-dom";
import { getSegments } from "../lib/segment-store";
import { exactSearch, hybridSearch } from "../lib/search";
import { formatTimestamp } from "../lib/transcript";
import type { SearchResult } from "../types";

let reactRoot: Root | null = null;
let appHost: HTMLElement | null = null;
let triggerContainer: HTMLElement | null = null;
let panelContainer: HTMLElement | null = null;
let domObserver: MutationObserver | null = null;
let playerObserver: MutationObserver | null = null;

function cleanup() {
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", waitForPlayerThenDOM);
} else {
  waitForPlayerThenDOM();
}

// Re-mount on YouTube SPA navigation
document.addEventListener("yt-navigate-finish", () => {
  cleanup();
  setTimeout(waitForPlayerThenDOM, 500);
});
