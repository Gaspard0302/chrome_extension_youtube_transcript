import React from "react";
import { createRoot } from "react-dom/client";
import Panel from "./components/Panel";
import "./content.css";

function mount() {
  // Avoid double-mounting
  if (document.getElementById("yt-transcript-root")) return;

  const host = document.createElement("div");
  host.id = "yt-transcript-root";
  host.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    z-index: 9999;
    pointer-events: none;
  `;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  shadow.appendChild(container);

  createRoot(container).render(<Panel />);
}

// YouTube is a SPA — mount on navigation too
function waitForPlayer() {
  const observer = new MutationObserver(() => {
    if (document.querySelector("#player")) {
      observer.disconnect();
      mount();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // Try immediately
  if (document.querySelector("#player")) mount();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", waitForPlayer);
} else {
  waitForPlayer();
}

// Re-mount on YouTube SPA navigation (yt-navigate-finish event)
document.addEventListener("yt-navigate-finish", () => {
  const existing = document.getElementById("yt-transcript-root");
  if (existing) existing.remove();
  setTimeout(mount, 500);
});
