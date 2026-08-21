import { describe, expect, it } from "vitest";
import { transcriptionMarkers } from "./mediaProcessing";

describe("speech timing markers", () => {
  it("prefers Whisper word timestamps when the transcription service returns them", () => {
    const markers = transcriptionMarkers({
      task: "transcribe",
      language: "en",
      duration: 2,
      text: "Hello there",
      segments: [{ id: 0, seek: 0, start: 0, end: 2, text: "Hello there", tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0.1 }],
      words: [{ word: "Hello", start: 0.12, end: 0.52 }, { word: "there", start: 0.6, end: 1.05 }],
    });
    expect(markers).toEqual([
      expect.objectContaining({ startMs: 120, endMs: 520, text: "Hello", confidence: 0.98 }),
      expect.objectContaining({ startMs: 600, endMs: 1050, text: "there", confidence: 0.98 }),
    ]);
  });
});
