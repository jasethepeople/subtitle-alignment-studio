import { describe, expect, it } from "vitest";
import { analyzeCueQa } from "./qaChecks";

describe("automated cue QA checks", () => {
  it("flags overlapping cues and dialogue exceeding the reading-speed target", () => {
    const findings = analyzeCueQa([
      { id: "cue-1", sequence: 1, startMs: 0, endMs: 1_000, plainText: "Short" },
      { id: "cue-2", sequence: 2, startMs: 800, endMs: 1_300, plainText: "This dialogue is deliberately long enough to exceed the reading speed target." },
    ]);
    expect(findings[1].overlapMs).toBe(200);
    expect(findings[1].charactersPerSecond).toBeGreaterThan(20);
    expect(findings[1].reasons).toEqual(expect.arrayContaining([expect.stringContaining("Overlaps"), expect.stringContaining("Reading speed")]));
  });
});
