import { describe, expect, it } from "vitest";
import { recommendAlignment, retimeCues } from "./alignment";

describe("hybrid subtitle alignment", () => {
  it("estimates a stable offset and retimes cue boundaries", () => {
    const cues = [
      { id: "a", startMs: 1000, endMs: 2200, richText: "One" },
      { id: "b", startMs: 5000, endMs: 6200, richText: "Two" },
      { id: "c", startMs: 9000, endMs: 10200, richText: "Three" },
    ];
    const markers = [
      { startMs: 1250, endMs: 2200, source: "transcript" as const, confidence: 0.95 },
      { startMs: 5250, endMs: 6200, source: "transcript" as const, confidence: 0.95 },
      { startMs: 9250, endMs: 10200, source: "transcript" as const, confidence: 0.95 },
    ];
    const recommendation = recommendAlignment(cues, markers);
    expect(recommendation.offsetMs).toBeCloseTo(250, -1);
    expect(recommendation.confidence).toBeGreaterThan(70);
    expect(retimeCues(cues, recommendation)[0]).toMatchObject({ startMs: 1250, endMs: 2450 });
  });
});
