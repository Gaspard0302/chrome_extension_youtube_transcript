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
import type { YouTubeChapter } from "./transcript";

export interface EmbeddingContext {
  title?: string | null;
  chapters?: YouTubeChapter[] | null;
}

function firstWords(text: string, n: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, n).join(" ");
}

function lastWords(text: string, n: number): string {
  return text.split(/\s+/).filter(Boolean).slice(-n).join(" ");
}

/**
 * Build the texts that actually get embedded, one per display chunk.
 *
 * The displayed chunk text stays untouched (exact search, citations and
 * timestamps keep working on it); only the embedding input is augmented:
 *  - prefixed with the video title and, when available, the chapter the chunk
 *    falls in — topical queries ("the part about X") match much better;
 *  - padded with ~12 words of overlap from the neighboring chunks, so queries
 *    about content near a chunk boundary still retrieve the right chunk.
 *
 * Word counts are kept conservative so the result stays within
 * all-MiniLM-L6-v2's 256-token window (overflow is silently truncated).
 */
export function buildEmbeddingTexts(
  chunks: TranscriptSegment[],
  context: EmbeddingContext = {}
): string[] {
  const OVERLAP_WORDS = 12;
  const title = context.title ? firstWords(context.title.trim(), 12) : "";
  const chapters = context.chapters ?? [];

  const chapterFor = (start: number): string => {
    let current = "";
    for (const ch of chapters) {
      if (ch.startTime <= start) current = ch.title;
      else break;
    }
    return current;
  };

  return chunks.map((chunk, i) => {
    const chapter = chapterFor(chunk.start);
    const prefix = [title, chapter].filter(Boolean).join(" — ");
    const before = i > 0 ? lastWords(chunks[i - 1].text, OVERLAP_WORDS) : "";
    const after = i < chunks.length - 1 ? firstWords(chunks[i + 1].text, OVERLAP_WORDS) : "";
    return [prefix ? `${prefix}.` : "", before, chunk.text, after]
      .filter(Boolean)
      .join(" ");
  });
}

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

/**
 * Embed all segments. When embedTexts is given (see buildEmbeddingTexts),
 * embedTexts[i] is what gets embedded while the segment keeps its original
 * display text — the index stays the segment ↔ embedding mapping.
 */
export async function embedSegments(
  segments: TranscriptSegment[],
  onProgress?: (pct: number) => void,
  embedTexts?: string[]
): Promise<EmbeddedSegment[]> {
  const embedded: EmbeddedSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const embedding = await embedText(embedTexts?.[i] || seg.text);
    embedded.push({ ...seg, embedding, index: i });
    onProgress?.(Math.round(((i + 1) / segments.length) * 100));
  }

  return embedded;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : Math.max(-1, Math.min(1, dot / denom));
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
