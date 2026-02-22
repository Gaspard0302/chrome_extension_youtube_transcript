/**
 * In-browser semantic embeddings using @huggingface/transformers.
 * Uses all-MiniLM-L6-v2 — small (23MB), fast, excellent for sentence similarity.
 * The model is downloaded once and cached by the browser.
 */

import type { EmbeddedSegment, TranscriptSegment } from "../types";

let pipeline: ((texts: string | string[], opts?: object) => Promise<{ data: Float32Array }[]>) | null = null;

async function getPipeline() {
  if (pipeline) return pipeline;

  const { pipeline: createPipeline } = await import("@huggingface/transformers");

  pipeline = await createPipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
    { device: "webgpu" }
  ) as typeof pipeline;

  return pipeline!;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function meanPool(data: Float32Array, dims: number[]): number[] {
  // dims: [batch, tokens, hidden]
  const [, seqLen, hiddenSize] = dims;
  const result = new Array<number>(hiddenSize).fill(0);
  for (let t = 0; t < seqLen; t++) {
    for (let h = 0; h < hiddenSize; h++) {
      result[h] += data[t * hiddenSize + h];
    }
  }
  for (let h = 0; h < hiddenSize; h++) {
    result[h] /= seqLen;
  }
  // L2 normalize
  const norm = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
  return result.map((v) => v / norm);
}

export async function embedText(text: string): Promise<number[]> {
  const pipe = await getPipeline();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  const tensor = output[0];
  return Array.from(tensor.data as Float32Array);
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
