export type QaCue = { id: string; sequence: number; startMs: number; endMs: number; plainText: string };
export type QaFinding = { cueId: string; reasons: string[]; charactersPerSecond: number; overlapMs: number };

const MAX_READING_SPEED = 20;

export function analyzeCueQa(cues: QaCue[]): QaFinding[] {
  const ordered = [...cues].sort((a, b) => a.startMs - b.startMs || a.sequence - b.sequence);
  return ordered.map((cue, index) => {
    const durationSeconds = Math.max(0.1, (cue.endMs - cue.startMs) / 1_000);
    const characters = cue.plainText.replace(/\s+/g, "").length;
    const charactersPerSecond = Math.round(characters / durationSeconds * 10) / 10;
    const previous = ordered[index - 1];
    const overlapMs = previous ? Math.max(0, previous.endMs - cue.startMs) : 0;
    const reasons: string[] = [];
    if (overlapMs > 0) reasons.push(`Overlaps previous cue by ${overlapMs} ms.`);
    if (charactersPerSecond > MAX_READING_SPEED) reasons.push(`Reading speed ${charactersPerSecond} cps exceeds the ${MAX_READING_SPEED} cps target.`);
    return { cueId: cue.id, reasons, charactersPerSecond, overlapMs };
  });
}
