/**
 * Offscreen document — embedding pipeline.
 *
 * Service workers cannot run WASM / dynamic import() at runtime, so the
 * transformers.js embedding pipeline lives here.
 *
 * Message flow:
 *   Embed: content → EMBED_TEXT → background → OFFSCREEN_EMBED_TEXT → offscreen → sendResponse
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
  if (message.type === "OFFSCREEN_EMBED_TEXT") {
    getPipeline()
      .then((pipe) =>
        pipe(message.payload.text, { pooling: "mean", normalize: true })
      )
      .then((output) => {
        sendResponse({
          embedding: Array.from(output[0].data as Float32Array),
        });
      })
      .catch((err) => {
        sendResponse({
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return true;
  }

  return false;
});
