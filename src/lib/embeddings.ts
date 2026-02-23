/**
 * Semantic embeddings via the background service worker.
 *
 * The transformers.js pipeline (all-MiniLM-L6-v2) is initialized in the
 * background service worker because Chrome blocks dynamic import() of
 * chrome-extension:// URLs in content script contexts. The background
 * worker has full extension context and can freely load the ORT WASM backend.
 *
 * embedText() sends an EMBED_TEXT message and awaits the response.
 * embedSegments() loops over segments, calling embedText with progress updates.
 */

import type { EmbeddedSegment, TranscriptSegment } from "../types";

export async function embedText(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "EMBED_TEXT", payload: { text } },
      (response: { embedding?: number[]; error?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response || response.error) {
          reject(new Error(response?.error ?? "No response from background"));
        } else {
          resolve(response.embedding!);
        }
      }
    );
  });
}

export async function embedSegments(
  segments: TranscriptSegment[],
  onProgress?: (pct: number) => void
): Promise<EmbeddedSegment[]> {
  const embedded: EmbeddedSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const embedding = await embedText(seg.text);
    embedded.push({ ...seg, embedding, index: i });
    onProgress?.(Math.round(((i + 1) / segments.length) * 100));
  }

  return embedded;
}

export function semanticSearch(
  query: number[],
  segments: EmbeddedSegment[],
  topK = 5
): Array<{ segment: EmbeddedSegment; score: number }> {
  const scored = segments.map((seg) => ({
    segment: seg,
    score: cosineSimilarity(query, seg.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
