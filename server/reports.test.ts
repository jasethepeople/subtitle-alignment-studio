import { describe, expect, it } from "vitest";
import { buildQaCsv, buildQaPdf } from "./reports";

const report = { title: "Episode 3", deliveryStatus: "approved", generatedAt: new Date("2026-08-21T00:00:00.000Z"), cues: [{ id: "cue-1", sequence: 1, startMs: 0, endMs: 1000, plainText: "Hello, world", alignmentConfidence: 88, qaStatus: "needs_review", qaReason: "Reading speed 23 cps exceeds target." }], assignments: [{ cueId: "cue-1", assigneeName: "Mia Chen" }], comments: [{ cueId: "cue-1", authorName: "Mia Chen", body: "Shorten line." }] };

describe("producer QA reports", () => {
  it("serializes approval, QA, assignment, and comment metadata into CSV and PDF", () => {
    const csv = buildQaCsv(report);
    const pdf = buildQaPdf(report).toString();
    expect(csv).toContain('"Hello, world"');
    expect(csv).toContain("Delivery approval,approved");
    expect(csv).toContain("needs_review");
    expect(csv).toContain("Mia Chen");
    expect(csv).toContain(",1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("APPROVED");
  });
});
