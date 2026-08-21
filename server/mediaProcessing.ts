import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { storageGetSignedUrl, storagePut } from "./storage";
import { transcribeAudio } from "./_core/voiceTranscription";
import { detectWaveformMarkers, type SpeechMarker } from "./alignment";
import { ENV } from "./_core/env";

const MAX_SOURCE_BYTES = 45 * 1024 * 1024;
const SAMPLE_RATE = 8_000;
const BUCKET_SAMPLES = 1_600;

type WordTimestamp = { word: string; start: number; end: number };
type DetailedTranscription = Awaited<ReturnType<typeof transcribeAudio>> & { words?: WordTimestamp[] };

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const process = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
    let stderr = "";
    process.stderr.on("data", chunk => { stderr += chunk.toString(); });
    process.on("error", error => reject(new Error(`FFmpeg is unavailable in this environment: ${error.message}`)));
    process.on("close", code => code === 0 ? resolve() : reject(new Error(`FFmpeg failed: ${stderr.slice(-600)}`)));
  });
}

async function downloadAsset(storageKey: string, expectedBytes?: number | null) {
  if (expectedBytes && expectedBytes > MAX_SOURCE_BYTES) throw new Error("Source media exceeds the 45 MB processing limit. Upload a shorter proxy or process this source in a dedicated media worker.");
  const url = await storageGetSignedUrl(storageKey);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to download the source media from storage.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_SOURCE_BYTES) throw new Error("Source media exceeds the 45 MB processing limit.");
  return buffer;
}

function extractAmplitudeBuckets(pcm: Buffer) {
  const bucketCount = Math.ceil(pcm.length / 2 / BUCKET_SAMPLES);
  const amplitudes: number[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const startSample = bucket * BUCKET_SAMPLES;
    const endSample = Math.min(startSample + BUCKET_SAMPLES, pcm.length / 2);
    let sum = 0;
    for (let sample = startSample; sample < endSample; sample += 1) sum += Math.abs(pcm.readInt16LE(sample * 2));
    amplitudes.push(endSample > startSample ? Math.round((sum / (endSample - startSample) / 32_767) * 10_000) / 10_000 : 0);
  }
  return amplitudes;
}

async function transcribeWithTimingGranularity(input: { audio: Buffer; audioUrl: string; language?: string }): Promise<DetailedTranscription> {
  const fallback = () => transcribeAudio({
    audioUrl: input.audioUrl,
    language: input.language,
    prompt: "Transcribe dialogue for subtitle timing alignment. Preserve spoken words and natural sentence boundaries.",
  });
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) return fallback();
  try {
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(input.audio)], { type: "audio/mpeg" }), "speech.mp3");
    body.append("model", "whisper-1");
    body.append("response_format", "verbose_json");
    body.append("timestamp_granularities[]", "word");
    body.append("timestamp_granularities[]", "segment");
    if (input.language) body.append("language", input.language);
    body.append("prompt", "Dialogue transcription for subtitle alignment. Preserve spoken words and natural sentence boundaries.");
    const endpoint = new URL("v1/audio/transcriptions", `${ENV.forgeApiUrl.replace(/\/$/, "")}/`).toString();
    const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${ENV.forgeApiKey}`, "Accept-Encoding": "identity" }, body });
    if (!response.ok) return fallback();
    const detailed = await response.json() as DetailedTranscription;
    if (!("text" in detailed) || !detailed.text) return fallback();
    return detailed;
  } catch {
    return fallback();
  }
}

export function transcriptionMarkers(transcription: DetailedTranscription): SpeechMarker[] {
  if ("error" in transcription) return [];
  if (Array.isArray(transcription.words) && transcription.words.length) {
    return transcription.words.map(word => ({
      startMs: Math.round(word.start * 1_000),
      endMs: Math.round(word.end * 1_000),
      source: "transcript" as const,
      confidence: 0.98,
      text: word.word.trim(),
    }));
  }
  return transcription.segments.map(segment => ({
    startMs: Math.round(segment.start * 1_000),
    endMs: Math.round(segment.end * 1_000),
    source: "transcript" as const,
    confidence: Math.max(0, Math.min(1, 1 - segment.no_speech_prob)),
    text: segment.text.trim(),
  }));
}

export async function processVideoForAlignment(input: { projectId: string; storageKey: string; filename: string; sizeBytes?: number | null; language?: string }) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "syncforge-"));
  try {
    const source = await downloadAsset(input.storageKey, input.sizeBytes);
    const extension = path.extname(input.filename) || ".mp4";
    const sourcePath = path.join(scratch, `source${extension}`);
    const pcmPath = path.join(scratch, "audio.pcm");
    const audioPath = path.join(scratch, "speech.mp3");
    await writeFile(sourcePath, source);
    await runFfmpeg(["-i", sourcePath, "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", pcmPath]);
    await runFfmpeg(["-i", sourcePath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audioPath]);
    const pcm = await readFile(pcmPath);
    const audio = await readFile(audioPath);
    if (audio.length > 16 * 1024 * 1024) throw new Error("The extracted speech audio is too large for transcription. Upload a shorter proxy or split the source into reels.");
    const amplitudes = extractAmplitudeBuckets(pcm);
    const bucketDurationMs = Math.round(BUCKET_SAMPLES / SAMPLE_RATE * 1_000);
    const waveform = { sampleRate: SAMPLE_RATE, bucketDurationMs, amplitudes };
    const waveformAsset = await storagePut(`projects/${input.projectId}/analysis/waveform.json`, JSON.stringify(waveform), "application/json");
    const audioAsset = await storagePut(`projects/${input.projectId}/analysis/speech.mp3`, audio, "audio/mpeg");
    const transcriptionUrl = await storageGetSignedUrl(audioAsset.key);
    const transcription = await transcribeWithTimingGranularity({ audio, audioUrl: transcriptionUrl, language: input.language });
    if ("error" in transcription) throw new Error(transcription.error);
    const transcriptMarkers = transcriptionMarkers(transcription);
    const waveformMarkers = detectWaveformMarkers(amplitudes, bucketDurationMs);
    const transcriptAsset = await storagePut(`projects/${input.projectId}/analysis/transcription.json`, JSON.stringify(transcription), "application/json");
    return { waveformAsset, audioAsset, transcriptAsset, waveform, markers: [...transcriptMarkers, ...waveformMarkers], transcription };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
