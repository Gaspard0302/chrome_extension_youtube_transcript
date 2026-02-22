import type { EmbeddedSegment, SearchResult, TranscriptSegment } from "../types";
import { embedText, semanticSearch } from "./embeddings";

/**
 * Exact / fuzzy text search across transcript segments.
 * Returns segments where the query appears (case-insensitive).
 */
export function exactSearch(
  query: string,
  segments: TranscriptSegment[]
): SearchResult[] {
  if (!query.trim()) return [];

  const q = query.toLowerCase().trim();
  const results: SearchResult[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.text.toLowerCase().includes(q)) {
      results.push({
        segment: seg,
        index: i,
        score: 1,
        matchType: "exact",
      });
    }
  }

  return results;
}

/**
 * Runs both exact and semantic search, deduplicates, and merges results.
 */
export async function hybridSearch(
  query: string,
  segments: EmbeddedSegment[],
  topK = 8
): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  // Always run exact search
  const exact = exactSearch(query, segments);
  const exactIndices = new Set(exact.map((r) => r.index));

  // Semantic search
  const queryEmbedding = await embedText(query);
  const semantic = semanticSearch(queryEmbedding, segments, topK);

  const results: SearchResult[] = [...exact];

  for (const { segment, score } of semantic) {
    if (!exactIndices.has(segment.index) && score > 0.3) {
      results.push({
        segment,
        index: segment.index,
        score,
        matchType: "semantic",
      });
    }
  }

  // Sort: exact matches first, then by semantic score
  results.sort((a, b) => {
    if (a.matchType === "exact" && b.matchType !== "exact") return -1;
    if (b.matchType === "exact" && a.matchType !== "exact") return 1;
    return b.score - a.score;
  });

  return results;
}

/**
 * Highlights occurrences of `query` in `text` with <mark> tags.
 */
export function highlightText(text: string, query: string): string {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
}
