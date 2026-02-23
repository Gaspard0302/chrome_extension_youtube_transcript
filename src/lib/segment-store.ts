import type { EmbeddedSegment } from "../types";

let _segments: EmbeddedSegment[] = [];

export function setSegments(segs: EmbeddedSegment[]): void {
  _segments = segs;
}

export function getSegments(): EmbeddedSegment[] {
  return _segments;
}
