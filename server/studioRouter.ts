import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { recommendAlignment, retimeCues, type SpeechMarker } from "./alignment";
import {
  createCueComment,
  createCueStatusHistory,
  createDeliveryAuditEvent,
  createMediaAsset,
  createProcessingRun,
  createProjectActivity,
  createProjectInvitation,
  createProjectMembership,
  createSubtitleProject,
  createSubtitleTrack,
  createTranslationRun,
  deleteSubtitleProject,
  getInvitationByToken,
  getOwnerNotificationPreference,
  getProjectEditorData,
  listProjectsForUser,
  replaceTrackCues,
  updateCue,
  updateProcessingRun,
  updateProjectInvitation,
  updateSubtitleProject,
  updateTranslationRun,
  upsertCueAssignment,
  upsertNotificationPreference,
} from "./db";
import { processVideoForAlignment, transcriptionMarkers } from "./mediaProcessing";
import { protectedProcedure, router } from "./_core/trpc";
import { notifyOwner } from "./_core/notification";
import { storagePut } from "./storage";
import { serializeAss, serializePlainText, serializeSrt, serializeVtt } from "./subtitles";
import { translateCueBatch } from "./translation";
import { analyzeCueQa } from "./qaChecks";
import { buildQaCsv, buildQaPdf, type QaReportData } from "./reports";
import { signAuditPayload, verifyAuditPayload, type AuditPayload } from "./audit";
import { sendInvitationEmail } from "./email";

function requireProject<T>(value: T | undefined): T {
  if (!value) throw new TRPCError({ code: "NOT_FOUND", message: "Subtitle project not found." });
  return value;
}

const projectInput = z.object({ projectId: z.string().min(4).max(64) });
const roleInput = z.enum(["producer", "reviewer", "viewer"]);
const roleRank = { viewer: 1, reviewer: 2, producer: 3, owner: 4 } as const;
type ProjectRole = keyof typeof roleRank;

function requireProjectRole(data: { accessRole: ProjectRole }, minimum: ProjectRole) {
  if (roleRank[data.accessRole] < roleRank[minimum]) throw new TRPCError({ code: "FORBIDDEN", message: `This action requires ${minimum}-level project access.` });
}

function reportData(data: { project: { title: string; deliveryStatus: string }; cues: QaReportData["cues"]; assignments: QaReportData["assignments"]; comments: QaReportData["comments"] }): QaReportData {
  return { title: data.project.title, deliveryStatus: data.project.deliveryStatus, generatedAt: new Date(), cues: data.cues, assignments: data.assignments, comments: data.comments };
}

async function recordActivity(input: { projectId: string; eventType: "invitation_created" | "invitation_accepted" | "invitation_revoked" | "qa_completed" | "delivery_submitted" | "delivery_approved" | "subtitle_exported" | "report_exported"; actorUserId?: number; actorName?: string; recipientUserId?: number; title: string; body: string; metadata?: Record<string, unknown>; alertOwner?: boolean }) {
  const { alertOwner, ...activity } = input;
  await createProjectActivity({ id: nanoid(), ...activity, metadata: activity.metadata || null });
  const preference = alertOwner ? await getOwnerNotificationPreference(activity.projectId) : undefined;
  const eventPreference = activity.eventType.startsWith("invitation_") ? preference?.inviteEvents : activity.eventType === "qa_completed" ? preference?.qaEvents : activity.eventType === "delivery_submitted" || activity.eventType === "delivery_approved" ? preference?.deliveryEvents : activity.eventType === "subtitle_exported" ? preference?.exportEvents : preference?.auditEvents;
  if (alertOwner && eventPreference !== false) {
    const accepted = await notifyOwner({ title: `SyncForge · ${activity.title}`, content: activity.body }).catch(() => false);
    if (!accepted) console.warn("[Activity] Owner alert was not accepted; retained in the in-app activity feed.");
  }
}

async function recordSignedAudit(input: { projectId: string; action: "approval_requested" | "delivery_approved" | "subtitle_exported"; actorUserId: number; actorName: string; details: Record<string, unknown> }) {
  const payload: AuditPayload = { projectId: input.projectId, action: input.action, actorUserId: input.actorUserId, actorName: input.actorName, occurredAt: new Date().toISOString(), details: input.details };
  const signed = signAuditPayload(payload);
  await createDeliveryAuditEvent({ id: nanoid(), projectId: input.projectId, action: input.action, actorUserId: input.actorUserId, actorName: input.actorName, payload, payloadDigest: signed.payloadDigest, signature: signed.signature });
}

export const studioRouter = router({
  list: protectedProcedure.query(({ ctx }) => listProjectsForUser(ctx.user.id)),
  get: protectedProcedure.input(projectInput).query(({ ctx, input }) => getProjectEditorData(ctx.user.id, input.projectId).then(requireProject)),
  create: protectedProcedure.input(z.object({ title: z.string().trim().min(1).max(180), sourceLanguage: z.string().trim().min(2).max(16).default("auto") })).mutation(async ({ ctx, input }) => {
    const id = nanoid();
    await createSubtitleProject({ id, userId: ctx.user.id, title: input.title, sourceLanguage: input.sourceLanguage, status: "draft" });
    return requireProject(await getProjectEditorData(ctx.user.id, id));
  }),
  rename: protectedProcedure.input(projectInput.extend({ title: z.string().trim().min(1).max(180) })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "producer");
    await updateSubtitleProject(input.projectId, { title: input.title });
    return { success: true };
  }),
  delete: protectedProcedure.input(projectInput).mutation(async ({ ctx, input }) => ({ success: await deleteSubtitleProject(ctx.user.id, input.projectId) })),
  updateCue: protectedProcedure.input(projectInput.extend({ cueId: z.string().min(4).max(64), startMs: z.number().int().min(0), endMs: z.number().int().min(1), richText: z.string().min(1).max(5000) })).mutation(async ({ ctx, input }) => {
    if (input.endMs <= input.startMs) throw new TRPCError({ code: "BAD_REQUEST", message: "Cue end time must follow its start time." });
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "reviewer");
    await updateCue(input.projectId, input.cueId, { startMs: input.startMs, endMs: input.endMs, richText: input.richText, plainText: input.richText.replace(/\{\\[^}]+\}|<\/?[^>]+>/g, "").replace(/\\N/g, " ").trim() });
    return { success: true };
  }),
  updateCueQa: protectedProcedure.input(projectInput.extend({ cueId: z.string().min(4).max(64), qaStatus: z.enum(["clear", "needs_review", "approved"]), qaReason: z.string().trim().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "reviewer");
    const cue = data.cues.find(item => item.id === input.cueId);
    if (!cue) throw new TRPCError({ code: "NOT_FOUND", message: "Subtitle cue not found." });
    await updateCue(input.projectId, input.cueId, { qaStatus: input.qaStatus, qaReason: input.qaReason || null });
    await createCueStatusHistory({ id: nanoid(), projectId: input.projectId, cueId: input.cueId, previousStatus: cue.qaStatus, nextStatus: input.qaStatus, reason: input.qaReason || null, changedByUserId: ctx.user.id, changedByName: ctx.user.name || "Reviewer" });
    return { success: true };
  }),
  saveUploadPreferences: protectedProcedure.input(projectInput.extend({ uploadConcurrency: z.number().int().min(1).max(4), uploadRetryLimit: z.number().int().min(0).max(5) })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "producer");
    await updateSubtitleProject(input.projectId, { uploadConcurrency: input.uploadConcurrency, uploadRetryLimit: input.uploadRetryLimit });
    return { success: true };
  }),
  assignCue: protectedProcedure.input(projectInput.extend({ cueId: z.string().min(4).max(64), assigneeName: z.string().trim().min(1).max(128) })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "reviewer");
    if (!data.cues.some(cue => cue.id === input.cueId)) throw new TRPCError({ code: "NOT_FOUND", message: "Subtitle cue not found." });
    await upsertCueAssignment({ id: `${input.projectId}-${input.cueId}`.slice(0, 36), projectId: input.projectId, cueId: input.cueId, assigneeName: input.assigneeName, assigneeUserId: null, assignedByUserId: ctx.user.id });
    return { success: true };
  }),
  addCueComment: protectedProcedure.input(projectInput.extend({ cueId: z.string().min(4).max(64), body: z.string().trim().min(1).max(2_000) })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "reviewer");
    if (!data.cues.some(cue => cue.id === input.cueId)) throw new TRPCError({ code: "NOT_FOUND", message: "Subtitle cue not found." });
    await createCueComment({ id: nanoid(), projectId: input.projectId, cueId: input.cueId, authorUserId: ctx.user.id, authorName: ctx.user.name || "Reviewer", body: input.body });
    return { success: true };
  }),
  runQa: protectedProcedure.input(projectInput.extend({ trackId: z.string().min(4).max(64).optional() })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "reviewer");
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
    await recordActivity({ projectId: input.projectId, eventType: "qa_completed", actorUserId: ctx.user.id, actorName: ctx.user.name || "Reviewer", title: "Automated QA scan completed", body: `${findings.filter(finding => finding.reasons.length).length} of ${cues.length} cues need review.`, metadata: { scanned: cues.length, flagged: findings.filter(finding => finding.reasons.length).length }, alertOwner: true });
    return { scanned: cues.length, flagged: findings.filter(finding => finding.reasons.length).length, overlapFlags: findings.filter(finding => finding.overlapMs > 0).length, speedFlags: findings.filter(finding => finding.charactersPerSecond > 20).length };
  }),
  autoAlign: protectedProcedure.input(projectInput).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "reviewer");
    const activeTrack = data.tracks.find(track => track.id === data.project.activeTrackId) || data.tracks.find(track => track.isPrimary);
    if (!activeTrack) throw new TRPCError({ code: "BAD_REQUEST", message: "Upload a subtitle track before running alignment." });
    const markers: SpeechMarker[] = [];
    for (const asset of data.assets.filter(asset => asset.kind === "transcription" || asset.kind === "waveform")) {
      const response = await fetch(asset.storageUrl);
      if (!response.ok) continue;
      const source = await response.json() as any;
      if (asset.kind === "transcription") markers.push(...transcriptionMarkers(source));
      else { const { detectWaveformMarkers } = await import("./alignment"); markers.push(...detectWaveformMarkers(source.amplitudes || [], source.bucketDurationMs || 200)); }
    }
    if (!markers.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Analyze a video source before running alignment." });
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
    requireProjectRole(data, "producer");
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
    requireProjectRole(data, "reviewer");
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
    if (data.project.deliveryStatus !== "approved") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Delivery export is blocked until a producer approves this subtitle project." });
    const track = data.tracks.find(item => item.id === input.trackId);
    if (!track) throw new TRPCError({ code: "NOT_FOUND", message: "Subtitle track not found." });
    const cues = data.cues.filter(cue => cue.trackId === track.id);
    const output = input.format === "srt" ? serializeSrt(cues) : input.format === "vtt" ? serializeVtt(cues) : input.format === "txt" ? serializePlainText(cues) : serializeAss(cues.map(cue => ({ startMs: cue.startMs, endMs: cue.endMs, richText: cue.richText, assStyle: cue.assStyle || undefined, speaker: cue.speaker || undefined })), track.styleProfile);
    const filename = `${data.project.title.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}-${track.language}.${input.format}`;
    const mimeType = input.format === "srt" ? "application/x-subrip" : input.format === "ass" ? "text/x-ssa" : input.format === "vtt" ? "text/vtt" : "text/plain";
    const stored = await storagePut(`projects/${input.projectId}/exports/${filename}`, output, mimeType);
    await createMediaAsset({ id: nanoid(), projectId: input.projectId, kind: "export", storageKey: stored.key, storageUrl: stored.url, filename, mimeType, sizeBytes: Buffer.byteLength(output) });
    await recordActivity({ projectId: input.projectId, eventType: "subtitle_exported", actorUserId: ctx.user.id, actorName: ctx.user.name || "Collaborator", title: "Approved subtitle export generated", body: `${filename} was generated after delivery approval.`, metadata: { filename, format: input.format } });
    await recordSignedAudit({ projectId: input.projectId, action: "subtitle_exported", actorUserId: ctx.user.id, actorName: ctx.user.name || "Collaborator", details: { filename, format: input.format, trackId: track.id, deliveryStatus: data.project.deliveryStatus } });
    return { filename, url: stored.url };
  }),
  inviteCollaborator: protectedProcedure.input(projectInput.extend({ email: z.string().trim().email().max(320), role: roleInput })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "owner");
    const token = nanoid(40);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
    const host = ctx.req.get?.("host") || ctx.req.headers.host || "app.manus.space";
    const origin = `${ctx.req.protocol}://${host}`;
    const inviteUrl = `${origin}/invite/${token}`;
    const delivery = await sendInvitationEmail({ to: input.email.toLowerCase(), inviterName: ctx.user.name || "A project owner", projectTitle: data.project.title, role: input.role, inviteUrl });
    await createProjectInvitation({ id: nanoid(), projectId: input.projectId, email: input.email.toLowerCase(), role: input.role, token, invitedByUserId: ctx.user.id, expiresAt, status: "pending", deliveryMode: delivery.delivered ? "provider_email" : "link_copy", deliveryStatus: delivery.delivered ? "sent" : "deferred", deliveredAt: delivery.delivered ? new Date() : null });
    await recordActivity({ projectId: input.projectId, eventType: "invitation_created", actorUserId: ctx.user.id, actorName: ctx.user.name || "Owner", title: delivery.delivered ? "Collaborator invitation emailed" : "Collaborator invite prepared", body: delivery.delivered ? `An invitation email was sent to ${input.email.toLowerCase()}.` : `Email delivery was unavailable: ${delivery.error} Copy the secure invitation link to deliver it manually.`, metadata: { email: input.email.toLowerCase(), role: input.role, delivery: delivery.delivered ? "provider_email" : "link_copy_fallback" }, alertOwner: true });
    return { token, expiresAt, deliveryStatus: delivery.delivered ? "sent" : "deferred", deliveryError: delivery.delivered ? null : delivery.error };
  }),
  revokeInvitation: protectedProcedure.input(projectInput.extend({ invitationId: z.string().min(4).max(64) })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "owner");
    if (!data.invitations.some(invitation => invitation.id === input.invitationId)) throw new TRPCError({ code: "NOT_FOUND", message: "Invitation not found." });
    await updateProjectInvitation(input.invitationId, { status: "revoked" });
    await recordActivity({ projectId: input.projectId, eventType: "invitation_revoked", actorUserId: ctx.user.id, actorName: ctx.user.name || "Owner", title: "Collaborator invite revoked", body: "A pending project invitation was revoked.", metadata: { invitationId: input.invitationId } });
    return { success: true };
  }),
  markInvitationLinkCopied: protectedProcedure.input(projectInput.extend({ invitationId: z.string().min(4).max(64) })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "owner");
    const invitation = data.invitations.find(item => item.id === input.invitationId);
    if (!invitation || invitation.status !== "pending") throw new TRPCError({ code: "NOT_FOUND", message: "Active invitation not found." });
    await updateProjectInvitation(input.invitationId, { deliveryMode: "link_copy", deliveryStatus: "link_copied", deliveredAt: new Date() });
    await recordActivity({ projectId: input.projectId, eventType: "invitation_created", actorUserId: ctx.user.id, actorName: ctx.user.name || "Owner", title: "Invitation link copied", body: `Secure invite link for ${invitation.email} was copied for manual delivery.`, metadata: { invitationId: invitation.id, delivery: "link_copied" } });
    return { success: true };
  }),
  acceptInvitation: protectedProcedure.input(z.object({ token: z.string().min(16).max(96) })).mutation(async ({ ctx, input }) => {
    const invitation = await getInvitationByToken(input.token);
    if (!invitation || invitation.status !== "pending") throw new TRPCError({ code: "NOT_FOUND", message: "Invitation is unavailable." });
    if (invitation.expiresAt.getTime() < Date.now()) { await updateProjectInvitation(invitation.id, { status: "expired" }); throw new TRPCError({ code: "BAD_REQUEST", message: "This invitation has expired." }); }
    if (!ctx.user.email || ctx.user.email.toLowerCase() !== invitation.email.toLowerCase()) throw new TRPCError({ code: "FORBIDDEN", message: "Sign in with the invited email address to accept this invitation." });
    await createProjectMembership({ id: nanoid(), projectId: invitation.projectId, userId: ctx.user.id, role: invitation.role, invitedByUserId: invitation.invitedByUserId });
    await updateProjectInvitation(invitation.id, { status: "accepted", acceptedAt: new Date(), acceptedByUserId: ctx.user.id });
    await recordActivity({ projectId: invitation.projectId, eventType: "invitation_accepted", actorUserId: ctx.user.id, actorName: ctx.user.name || "Collaborator", recipientUserId: invitation.invitedByUserId, title: "Collaborator joined the project", body: `${ctx.user.name || "A collaborator"} accepted a ${invitation.role} invitation.`, metadata: { role: invitation.role }, alertOwner: true });
    return { projectId: invitation.projectId, role: invitation.role };
  }),
  requestDeliveryApproval: protectedProcedure.input(projectInput).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "reviewer");
    await updateSubtitleProject(input.projectId, { deliveryStatus: "in_review" });
    await recordActivity({ projectId: input.projectId, eventType: "delivery_submitted", actorUserId: ctx.user.id, actorName: ctx.user.name || "Reviewer", title: "Delivery submitted for approval", body: "A reviewer submitted the subtitle deliverables for producer approval.", alertOwner: true });
    await recordSignedAudit({ projectId: input.projectId, action: "approval_requested", actorUserId: ctx.user.id, actorName: ctx.user.name || "Reviewer", details: { deliveryStatus: "in_review" } });
    return { success: true };
  }),
  approveDelivery: protectedProcedure.input(projectInput).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "producer");
    if (data.project.deliveryStatus !== "in_review") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Delivery must be submitted for review before approval." });
    await updateSubtitleProject(input.projectId, { deliveryStatus: "approved" });
    await recordActivity({ projectId: input.projectId, eventType: "delivery_approved", actorUserId: ctx.user.id, actorName: ctx.user.name || "Producer", title: "Delivery approved", body: "A producer approved subtitle exports for this project.", alertOwner: true });
    await recordSignedAudit({ projectId: input.projectId, action: "delivery_approved", actorUserId: ctx.user.id, actorName: ctx.user.name || "Producer", details: { previousStatus: "in_review", deliveryStatus: "approved" } });
    return { success: true };
  }),
  exportQaReport: protectedProcedure.input(projectInput.extend({ format: z.enum(["csv", "pdf"]) })).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "reviewer");
    const report = reportData(data);
    const filename = `${data.project.title.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}-qa-report.${input.format}`;
    const content = input.format === "csv" ? buildQaCsv(report) : buildQaPdf(report);
    const mimeType = input.format === "csv" ? "text/csv" : "application/pdf";
    const stored = await storagePut(`projects/${input.projectId}/reports/${filename}`, content, mimeType);
    await createMediaAsset({ id: nanoid(), projectId: input.projectId, kind: "export", storageKey: stored.key, storageUrl: stored.url, filename, mimeType, sizeBytes: Buffer.byteLength(content) });
    await recordActivity({ projectId: input.projectId, eventType: "report_exported", actorUserId: ctx.user.id, actorName: ctx.user.name || "Reviewer", title: "Producer QA report generated", body: `${filename} is ready for download.`, metadata: { filename, format: input.format } });
    return { filename, url: stored.url };
  }),
  verifyDeliveryAudit: protectedProcedure.input(projectInput.extend({ auditEventId: z.string().min(4).max(64) })).query(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    const event = data.auditEvents.find(item => item.id === input.auditEventId);
    if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Audit event not found." });
    const valid = verifyAuditPayload(event.payload as AuditPayload, event.signature);
    return { valid, action: event.action, payloadDigest: event.payloadDigest, createdAt: event.createdAt };
  }),
  exportDeliveryAudit: protectedProcedure.input(projectInput).mutation(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "producer");
    const rows = [["Action", "Actor", "Timestamp", "Payload digest", "Signature"], ...data.auditEvents.map(event => [event.action, event.actorName, event.createdAt.toISOString(), event.payloadDigest, event.signature])];
    const output = rows.map(row => row.map(value => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value).join(",")).join("\n") + "\n";
    const filename = `${data.project.title.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}-delivery-audit.csv`;
    const stored = await storagePut(`projects/${input.projectId}/reports/${filename}`, output, "text/csv");
    await createMediaAsset({ id: nanoid(), projectId: input.projectId, kind: "export", storageKey: stored.key, storageUrl: stored.url, filename, mimeType: "text/csv", sizeBytes: Buffer.byteLength(output) });
    await recordActivity({ projectId: input.projectId, eventType: "report_exported", actorUserId: ctx.user.id, actorName: ctx.user.name || "Producer", title: "Signed delivery ledger exported", body: `${filename} is ready for download.`, metadata: { filename, report: "delivery_audit" } });
    return { filename, url: stored.url };
  }),
  saveNotificationPreferences: protectedProcedure.input(projectInput.extend({ inviteEvents: z.boolean(), qaEvents: z.boolean(), deliveryEvents: z.boolean(), exportEvents: z.boolean(), auditEvents: z.boolean() })).mutation(async ({ ctx, input }) => {
    requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    await upsertNotificationPreference({ id: `${input.projectId}-${ctx.user.id}`.slice(0, 36), projectId: input.projectId, userId: ctx.user.id, inviteEvents: input.inviteEvents, qaEvents: input.qaEvents, deliveryEvents: input.deliveryEvents, exportEvents: input.exportEvents, auditEvents: input.auditEvents });
    return { success: true };
  }),
  searchDeliveryAudit: protectedProcedure.input(projectInput.extend({ action: z.enum(["approval_requested", "delivery_approved", "subtitle_exported"]).optional(), collaborator: z.string().trim().max(128).optional() })).query(async ({ ctx, input }) => {
    const data = requireProject(await getProjectEditorData(ctx.user.id, input.projectId));
    requireProjectRole(data, "reviewer");
    const collaborator = input.collaborator?.toLowerCase();
    return data.auditEvents.filter(event => (!input.action || event.action === input.action) && (!collaborator || event.actorName.toLowerCase().includes(collaborator))).slice(0, 100);
  }),
});
