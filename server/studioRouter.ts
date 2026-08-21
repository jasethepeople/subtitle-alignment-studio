import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { recommendAlignment, retimeCues, type SpeechMarker } from "./alignment";
import {
  createCueComment,
  createCueStatusHistory,
  createMediaAsset,
  createProcessingRun,
  createSubtitleProject,
  createSubtitleTrack,
  createTranslationRun,
  deleteSubtitleProject,
  getProjectEditorData,
  listProjectsForUser,
  replaceTrackCues,
  updateCue,
  updateProcessingRun,
  updateSubtitleProject,
  updateTranslationRun,
  upsertCueAssignment,
} from "./db";
import { processVideoForAlignment, transcriptionMarkers } from "./mediaProcessing";
import { protectedProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";
import { serializeAss, serializePlainText, serializeSrt, serializeVtt } from "./subtitles";
import { translateCueBatch } from "./translation";
import { analyzeCueQa } from "./qaChecks";

function requireProject<T>(value: T | undefined): T {
  if (!value) throw new TRPCError({ code: "NOT_FOUND", message: "Subtitle project not found." });
  return value;
}

const projectInput = z.object({ projectId: z.string().min(4).max(64) });

export const studioRouter = router({
  list: protectedProcedure.query(({ ctx }) => listProjectsForUser(ctx.user.id)),
  get: protectedProcedure.input(projectInput).query(async ({ ctx, input }) => requireProject(await getProjectEditorData(ctx.user.id, input.projectId))),
  create: protectedProcedure.input(z.object({ title: z.string().trim().min(1).max(180), sourceLanguage: z.string().trim().min(2).max(16).default("auto") })).mutation(async ({ ctx, input }) => {
    const id = nanoid();
    await createSubtitleProject({ id, userId: ctx.user.id, title: input.title, sourceLanguage: input.sourceLanguage, status: "draft" });
    return requireProject(await getProjectEditorData(ctx.user.id, id));
  }),
  rename: protectedProcedure.input(projectInput.extend({ title: z.string().trim().min(1).max(180) })).mutation(async ({ ctx, input }) => {
    requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    await updateSubtitleProject(input.projectId, { title: input.title });
    return { success: true };
  }),
  delete: protectedProcedure.input(projectInput).mutation(async ({ ctx, input }) => ({ success: await deleteSubtitleProject(ctx.user.id, input.projectId) })),
  updateCue: protectedProcedure.input(projectInput.extend({ cueId: z.string().min(4).max(64), startMs: z.number().int().min(0), endMs: z.number().int().min(1), richText: z.string().min(1).max(5000) })).mutation(async ({ ctx, input }) => {
    if (input.endMs <= input.startMs) throw new TRPCError({ code: "BAD_REQUEST", message: "Cue end time must follow its start time." });
    requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    await updateCue(input.projectId, input.cueId, { startMs: input.startMs, endMs: input.endMs, richText: input.richText, plainText: input.richText.replace(/\{\\[^}]+\}|<\/?[^>]+>/g, "").replace(/\\N/g, " ").trim() });
    return { success: true };
  }),
  updateCueQa: protectedProcedure.input(projectInput.extend({ cueId: z.string().min(4).max(64), qaStatus: z.enum(["clear", "needs_review", "approved"]), qaReason: z.string().trim().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    const cue = data.cues.find(item => item.id === input.cueId);
    if (!cue) throw new TRPCError({ code: "NOT_FOUND", message: "Subtitle cue not found." });
    await updateCue(input.projectId, input.cueId, { qaStatus: input.qaStatus, qaReason: input.qaReason || null });
    await createCueStatusHistory({ id: nanoid(), projectId: input.projectId, cueId: input.cueId, previousStatus: cue.qaStatus, nextStatus: input.qaStatus, reason: input.qaReason || null, changedByUserId: ctx.user.id, changedByName: ctx.user.name || "Reviewer" });
    return { success: true };
  }),
  saveUploadPreferences: protectedProcedure.input(projectInput.extend({ uploadConcurrency: z.number().int().min(1).max(4), uploadRetryLimit: z.number().int().min(0).max(5) })).mutation(async ({ ctx, input }) => {
    requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    await updateSubtitleProject(input.projectId, { uploadConcurrency: input.uploadConcurrency, uploadRetryLimit: input.uploadRetryLimit });
    return { success: true };
  }),
  assignCue: protectedProcedure.input(projectInput.extend({ cueId: z.string().min(4).max(64), assigneeName: z.string().trim().min(1).max(128) })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    if (!data.cues.some(cue => cue.id === input.cueId)) throw new TRPCError({ code: "NOT_FOUND", message: "Subtitle cue not found." });
    await upsertCueAssignment({ id: `${input.projectId}-${input.cueId}`.slice(0, 36), projectId: input.projectId, cueId: input.cueId, assigneeName: input.assigneeName, assigneeUserId: null, assignedByUserId: ctx.user.id });
    return { success: true };
  }),
  addCueComment: protectedProcedure.input(projectInput.extend({ cueId: z.string().min(4).max(64), body: z.string().trim().min(1).max(2_000) })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    if (!data.cues.some(cue => cue.id === input.cueId)) throw new TRPCError({ code: "NOT_FOUND", message: "Subtitle cue not found." });
    await createCueComment({ id: nanoid(), projectId: input.projectId, cueId: input.cueId, authorUserId: ctx.user.id, authorName: ctx.user.name || "Reviewer", body: input.body });
    return { success: true };
  }),
  runQa: protectedProcedure.input(projectInput.extend({ trackId: z.string().min(4).max(64).optional() })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    const activeTrackId = input.trackId || data.project.activeTrackId || data.tracks.find(track => track.isPrimary)?.id;
    const cues = data.cues.filter(cue => cue.trackId === activeTrackId);
    const findings = analyzeCueQa(cues);
    const findingByCue = new Map(findings.map(finding => [finding.cueId, finding]));
    await Promise.all(cues.map(async cue => {
      const finding = findingByCue.get(cue.id)!;
      const qaStatus = finding.reasons.length ? "needs_review" : cue.qaStatus === "approved" ? "approved" : "clear";
      const qaReason = finding.reasons.join(" ") || null;
      await updateCue(input.projectId, cue.id, { qaStatus, qaReason });
      if (cue.qaStatus !== qaStatus || cue.qaReason !== qaReason) await createCueStatusHistory({ id: nanoid(), projectId: input.projectId, cueId: cue.id, previousStatus: cue.qaStatus, nextStatus: qaStatus, reason: qaReason, changedByUserId: ctx.user.id, changedByName: ctx.user.name || "QA scan" });
    }));
    return { scanned: cues.length, flagged: findings.filter(finding => finding.reasons.length).length, overlapFlags: findings.filter(finding => finding.overlapMs > 0).length, speedFlags: findings.filter(finding => finding.charactersPerSecond > 20).length };
  }),
  autoAlign: protectedProcedure.input(projectInput).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    const activeTrack = data.tracks.find(track => track.id === data.project.activeTrackId) || data.tracks.find(track => track.isPrimary);
    if (!activeTrack) throw new TRPCError({ code: "BAD_REQUEST", message: "Upload a subtitle track before running alignment." });
    const transcriptAsset = data.assets.find(asset => asset.kind === "transcription");
    const waveformAsset = data.assets.find(asset => asset.kind === "waveform");
    if (!transcriptAsset && !waveformAsset) throw new TRPCError({ code: "BAD_REQUEST", message: "Analyze a video source before running alignment." });
    const markers: SpeechMarker[] = [];
    for (const asset of [transcriptAsset, waveformAsset].filter(Boolean)) {
      const response = await fetch(asset!.storageUrl);
      if (!response.ok) continue;
      const source = await response.json() as any;
      if (asset!.kind === "transcription") markers.push(...transcriptionMarkers(source));
      if (asset!.kind === "waveform") {
        const { detectWaveformMarkers } = await import("./alignment");
        markers.push(...detectWaveformMarkers(source.amplitudes || [], source.bucketDurationMs || 200));
      }
    }
    const trackCues = data.cues.filter(cue => cue.trackId === activeTrack.id);
    const recommendation = recommendAlignment(trackCues, markers);
    const retimed = retimeCues(trackCues.map(cue => ({ id: cue.id, startMs: cue.startMs, endMs: cue.endMs, richText: cue.richText })), recommendation);
    const lookup = new Map(retimed.map(cue => [cue.id, cue]));
    await replaceTrackCues(input.projectId, activeTrack.id, trackCues.map(cue => ({ ...cue, id: cue.id, startMs: lookup.get(cue.id)!.startMs, endMs: lookup.get(cue.id)!.endMs, alignmentConfidence: recommendation.confidence, qaStatus: recommendation.confidence < 75 ? "needs_review" : "clear", qaReason: recommendation.confidence < 75 ? "Alignment confidence fell below the 75% QA threshold." : null })));
    await updateSubtitleProject(input.projectId, { status: "ready" });
    return recommendation;
  }),
  processVideo: protectedProcedure.input(projectInput.extend({ language: z.string().trim().min(2).max(16).optional() })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    const video = data.assets.find(asset => asset.kind === "video");
    if (!video) throw new TRPCError({ code: "BAD_REQUEST", message: "Upload an MP4 or MKV source before analysis." });
    const runId = nanoid();
    await createProcessingRun({ id: runId, projectId: input.projectId, type: "waveform", status: "processing", summary: "Extracting audio waveform and timestamped speech markers." });
    await updateSubtitleProject(input.projectId, { status: "processing" });
    try {
      const result = await processVideoForAlignment({ projectId: input.projectId, storageKey: video.storageKey, filename: video.filename, sizeBytes: video.sizeBytes, language: input.language });
      await Promise.all([
        createMediaAsset({ id: nanoid(), projectId: input.projectId, kind: "waveform", storageKey: result.waveformAsset.key, storageUrl: result.waveformAsset.url, filename: "waveform.json", mimeType: "application/json", sizeBytes: JSON.stringify(result.waveform).length }),
        createMediaAsset({ id: nanoid(), projectId: input.projectId, kind: "audio", storageKey: result.audioAsset.key, storageUrl: result.audioAsset.url, filename: "speech.mp3", mimeType: "audio/mpeg" }),
        createMediaAsset({ id: nanoid(), projectId: input.projectId, kind: "transcription", storageKey: result.transcriptAsset.key, storageUrl: result.transcriptAsset.url, filename: "transcription.json", mimeType: "application/json", sizeBytes: JSON.stringify(result.transcription).length }),
      ]);
      await updateProcessingRun(runId, { status: "ready", summary: `Generated ${result.waveform.amplitudes.length} waveform buckets and ${result.transcription.segments.length} speech segments.` });
      await updateSubtitleProject(input.projectId, { status: "ready", durationMs: Math.round(result.transcription.duration * 1000) });
      return { success: true, waveformPoints: result.waveform.amplitudes.length, speechSegments: result.transcription.segments.length };
    } catch (error) {
      await updateProcessingRun(runId, { status: "failed", summary: error instanceof Error ? error.message : "Video analysis failed." });
      await updateSubtitleProject(input.projectId, { status: "attention" });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Video analysis failed." });
    }
  }),
  translate: protectedProcedure.input(projectInput.extend({ targetLanguage: z.string().trim().min(2).max(16), sourceTrackId: z.string().min(4).max(64).optional() })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    const sourceTrack = data.tracks.find(track => track.id === input.sourceTrackId) || data.tracks.find(track => track.id === data.project.activeTrackId) || data.tracks.find(track => track.isPrimary);
    if (!sourceTrack) throw new TRPCError({ code: "BAD_REQUEST", message: "No subtitle track is available for translation." });
    const sourceCues = data.cues.filter(cue => cue.trackId === sourceTrack.id);
    const runId = nanoid();
    await createTranslationRun({ id: runId, projectId: input.projectId, sourceTrackId: sourceTrack.id, targetLanguage: input.targetLanguage, status: "processing" });
    try {
      const result = await translateCueBatch(sourceCues.map(cue => ({ id: cue.id, richText: cue.richText, plainText: cue.plainText })), input.targetLanguage, sourceTrack.language);
      const targetTrackId = nanoid();
      await createSubtitleTrack({ id: targetTrackId, projectId: input.projectId, name: `${sourceTrack.name} · ${input.targetLanguage.toUpperCase()}`, language: input.targetLanguage, format: sourceTrack.format, isPrimary: false, styleProfile: sourceTrack.styleProfile });
      const translated = new Map(result.cues.map(cue => [cue.id, cue]));
      await replaceTrackCues(input.projectId, targetTrackId, sourceCues.map(cue => ({ ...cue, id: nanoid(), trackId: targetTrackId, richText: translated.get(cue.id)!.richText, plainText: translated.get(cue.id)!.plainText })));
      await updateTranslationRun(runId, { status: "ready", targetTrackId, model: result.model });
      return { targetTrackId, model: result.model, translatedCueCount: result.cues.length };
    } catch (error) {
      await updateTranslationRun(runId, { status: "failed", errorMessage: error instanceof Error ? error.message : "Translation failed." });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Translation failed." });
    }
  }),
  export: protectedProcedure.input(projectInput.extend({ trackId: z.string().min(4).max(64), format: z.enum(["srt", "ass", "vtt", "txt"]) })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    const track = data.tracks.find(item => item.id === input.trackId);
    if (!track) throw new TRPCError({ code: "NOT_FOUND", message: "Subtitle track not found." });
    const cues = data.cues.filter(cue => cue.trackId === track.id);
    const output = input.format === "srt" ? serializeSrt(cues)
      : input.format === "vtt" ? serializeVtt(cues)
      : input.format === "txt" ? serializePlainText(cues)
      : serializeAss(cues.map(cue => ({
          startMs: cue.startMs,
          endMs: cue.endMs,
          richText: cue.richText,
          assStyle: cue.assStyle || undefined,
          speaker: cue.speaker || undefined,
        })), track.styleProfile);
    const filename = `${data.project.title.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}-${track.language}.${input.format}`;
    const mimeType = input.format === "srt" ? "application/x-subrip" : input.format === "ass" ? "text/x-ssa" : input.format === "vtt" ? "text/vtt" : "text/plain";
    const stored = await storagePut(`projects/${input.projectId}/exports/${filename}`, output, mimeType);
    await createMediaAsset({ id: nanoid(), projectId: input.projectId, kind: "export", storageKey: stored.key, storageUrl: stored.url, filename, mimeType, sizeBytes: Buffer.byteLength(output) });
    return { filename, url: stored.url };
  }),
});
