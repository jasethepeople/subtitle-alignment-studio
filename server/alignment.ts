export type AlignmentCue = { id: string; startMs: number; endMs: number; richText: string };
export type SpeechMarker = { startMs: number; endMs: number; source: "waveform" | "transcript"; confidence: number; text?: string };

export type AlignmentRecommendation = {
  offsetMs: number;
  driftPpm: number;
  scale: number;
  confidence: number;
  matchedMarkers: number;
  notes: string[];
};

export function detectWaveformMarkers(amplitudes: number[], bucketDurationMs: number, threshold = 0.16): SpeechMarker[] {
  const markers: SpeechMarker[] = [];
  let startIndex: number | null = null;
  for (let index = 0; index < amplitudes.length; index += 1) {
    const active = amplitudes[index] >= threshold;
    if (active && startIndex === null) startIndex = index;
    if ((!active || index === amplitudes.length - 1) && startIndex !== null) {
      const endIndex = active && index === amplitudes.length - 1 ? index + 1 : index;
      if (endIndex - startIndex >= 1) {
        const slice = amplitudes.slice(startIndex, endIndex);
        const peak = Math.max(...slice);
        markers.push({
          startMs: startIndex * bucketDurationMs,
          endMs: endIndex * bucketDurationMs,
          source: "waveform",
          confidence: Math.min(0.8, 0.25 + peak),
        });
      }
      startIndex = null;
    }
  }
  return markers;
}

export function recommendAlignment(cues: AlignmentCue[], markers: SpeechMarker[]): AlignmentRecommendation {
  if (!cues.length || !markers.length) {
    return { offsetMs: 0, driftPpm: 0, scale: 1, confidence: 0, matchedMarkers: 0, notes: ["Add both source subtitles and analyzed speech markers to calculate a timing recommendation."] };
  }
  const transcriptionMarkers = markers.filter(marker => marker.source === "transcript");
  const candidateMarkers = transcriptionMarkers.length ? transcriptionMarkers : markers;
  const pairs = cues.map(cue => {
    const nearest = candidateMarkers.reduce((best, marker) => Math.abs(marker.startMs - cue.startMs) < Math.abs(best.startMs - cue.startMs) ? marker : best, candidateMarkers[0]);
    return { cueStart: cue.startMs, markerStart: nearest.startMs, distance: Math.abs(nearest.startMs - cue.startMs), marker: nearest };
  }).filter(pair => pair.distance <= 12_000);
  if (pairs.length < 2) {
    const offset = pairs.length ? Math.round(pairs[0].markerStart - pairs[0].cueStart) : 0;
    return { offsetMs: offset, driftPpm: 0, scale: 1, confidence: pairs.length ? 35 : 0, matchedMarkers: pairs.length, notes: ["Only a constant offset could be estimated from the available matching points."] };
  }
  const xMean = pairs.reduce((sum, pair) => sum + pair.cueStart, 0) / pairs.length;
  const yMean = pairs.reduce((sum, pair) => sum + pair.markerStart, 0) / pairs.length;
  const variance = pairs.reduce((sum, pair) => sum + (pair.cueStart - xMean) ** 2, 0);
  const covariance = pairs.reduce((sum, pair) => sum + (pair.cueStart - xMean) * (pair.markerStart - yMean), 0);
  const unclampedScale = variance > 0 ? covariance / variance : 1;
  const scale = Math.max(0.94, Math.min(1.06, unclampedScale));
  const offsetMs = Math.round(yMean - scale * xMean);
  const meanResidual = pairs.reduce((sum, pair) => sum + Math.abs(pair.markerStart - (scale * pair.cueStart + offsetMs)), 0) / pairs.length;
  const transcriptBonus = transcriptionMarkers.length ? 16 : 0;
  const confidence = Math.max(0, Math.min(98, Math.round(72 - meanResidual / 90 + transcriptBonus + Math.min(10, pairs.length))));
  return {
    offsetMs,
    driftPpm: Math.round((scale - 1) * 1_000_000),
    scale,
    confidence,
    matchedMarkers: pairs.length,
    notes: [
      transcriptionMarkers.length ? "Timestamped speech segments were prioritized over amplitude-only matches." : "Waveform onsets were used because no transcription markers were available.",
      `Estimated drift is ${Math.round((scale - 1) * 100_000) / 100}% across the project timeline.`,
    ],
  };
}

export function retimeCues<T extends AlignmentCue>(cues: T[], recommendation: Pick<AlignmentRecommendation, "scale" | "offsetMs" | "confidence">): Array<T & { alignmentConfidence: number }> {
  return cues.map(cue => {
    const startMs = Math.max(0, Math.round(cue.startMs * recommendation.scale + recommendation.offsetMs));
    const endMs = Math.max(startMs + 120, Math.round(cue.endMs * recommendation.scale + recommendation.offsetMs));
    return { ...cue, startMs, endMs, alignmentConfidence: recommendation.confidence };
  });
}
