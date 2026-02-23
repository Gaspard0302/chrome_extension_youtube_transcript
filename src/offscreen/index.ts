/**
 * Offscreen document — embedding pipeline host.
 *
 * Chrome service workers cannot use dynamic import() at runtime (HTML spec
 * restriction), and content scripts cannot load chrome-extension:// modules
 * dynamically. Offscreen documents are regular extension pages: they have
 * `window`, can do dynamic imports, and can run WASM. They persist until
 * explicitly closed and communicate via chrome.runtime.onMessage.
 *
 * Message flow:
 *   content script → EMBED_TEXT → background SW
 *   background SW  → OFFSCREEN_EMBED_TEXT → offscreen doc
 *   offscreen doc  → sendResponse({ embedding }) → background SW → content script
 */

import { pipeline, env } from "@huggingface/transformers";

// Point ORT to local extension files. Offscreen documents are extension pages
// so chrome.runtime.getURL() and dynamic import() both work here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(env.backends.onnx as any).wasm.wasmPaths = chrome.runtime.getURL("");

type EmbedPipeline = (
  text: string | string[],
  opts?: object
) => Promise<{ data: Float32Array }[]>;

let embedPipeline: EmbedPipeline | null = null;

async function getPipeline(): Promise<EmbedPipeline> {
  if (embedPipeline) return embedPipeline;
  embedPipeline = (await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
    { device: "wasm", dtype: "fp32" }
  )) as unknown as EmbedPipeline;
  return embedPipeline;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "OFFSCREEN_EMBED_TEXT") return false;

  getPipeline()
    .then((pipe) => pipe(message.payload.text, { pooling: "mean", normalize: true }))
    .then((output) => {
      sendResponse({ embedding: Array.from(output[0].data as Float32Array) });
    })
    .catch((err) => {
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });

  return true; // keep message channel open for async response
});
