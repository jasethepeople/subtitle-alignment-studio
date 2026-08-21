import { describe, expect, it } from "vitest";
import { parseAss, parseSrt, serializeAss, serializeSrt } from "./subtitles";

describe("subtitle parser and serializer", () => {
  it("preserves SRT formatting tags and millisecond timecodes", () => {
    const parsed = parseSrt("1\n00:00:01,250 --> 00:00:03,500\n<i>Hello</i> <b>world</b>\n");
    expect(parsed.cues[0]).toMatchObject({ startMs: 1250, endMs: 3500, richText: "<i>Hello</i> <b>world</b>", plainText: "Hello world" });
    expect(serializeSrt(parsed.cues)).toContain("00:00:01,250 --> 00:00:03,500");
    expect(serializeSrt(parsed.cues)).toContain("<i>Hello</i>");
  });

  it("preserves ASS style, speaker, positioning tags, and dialogue text", () => {
    const parsed = parseAss("[Script Info]\nTitle: Test\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\nDialogue: 0,0:00:01.20,0:00:03.50,Top,ALICE,0,0,0,,{\\an8}{\\i1}Hello{\\i0}\n");
    expect(parsed.cues[0]).toMatchObject({ startMs: 1200, endMs: 3500, assStyle: "Top", speaker: "ALICE", richText: "{\\an8}{\\i1}Hello{\\i0}" });
    expect(serializeAss(parsed.cues, parsed.styleProfile)).toContain("{\\an8}{\\i1}Hello{\\i0}");
  });
});
