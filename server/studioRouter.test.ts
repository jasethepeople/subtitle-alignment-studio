import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const db = vi.hoisted(() => ({
  createCueComment: vi.fn(), createCueStatusHistory: vi.fn(), createDeliveryAuditEvent: vi.fn(), createMediaAsset: vi.fn(), createProcessingRun: vi.fn(), createProjectActivity: vi.fn(), createProjectInvitation: vi.fn(), createProjectMembership: vi.fn(), createSubtitleProject: vi.fn(), createSubtitleTrack: vi.fn(), createTranslationRun: vi.fn(),
  deleteSubtitleProject: vi.fn(), getInvitationByToken: vi.fn(), getProjectEditorData: vi.fn(), listProjectsForUser: vi.fn(), replaceTrackCues: vi.fn(), updateCue: vi.fn(),
  updateProcessingRun: vi.fn(), updateProjectInvitation: vi.fn(), updateSubtitleProject: vi.fn(), updateTranslationRun: vi.fn(), upsertCueAssignment: vi.fn(), upsertNotificationPreference: vi.fn(), getOwnerNotificationPreference: vi.fn(),
}));
const storage = vi.hoisted(() => ({ storagePut: vi.fn() }));
const ownerNotification = vi.hoisted(() => ({ notifyOwner: vi.fn().mockResolvedValue(true) }));
const emailDelivery = vi.hoisted(() => ({ sendInvitationEmail: vi.fn().mockResolvedValue({ delivered: true, providerId: "email-123" }) }));

vi.mock("./db", () => db);
vi.mock("./storage", () => storage);
vi.mock("./_core/notification", () => ownerNotification);
vi.mock("./email", () => emailDelivery);

import { appRouter } from "./routers";

const editorData = {
  project: { id: "project-1", userId: 42, title: "Master Dialogue", sourceLanguage: "en", status: "ready", deliveryStatus: "approved" as const, durationMs: 8_000, activeTrackId: "track-1", createdAt: new Date(), updatedAt: new Date() },
  accessRole: "owner" as const,
  assets: [],
  tracks: [{ id: "track-1", projectId: "project-1", name: "English", language: "en", format: "srt", isPrimary: true, styleProfile: null, createdAt: new Date(), updatedAt: new Date() }],
  cues: [{ id: "cue-1", projectId: "project-1", trackId: "track-1", sequence: 1, startMs: 1_000, endMs: 2_000, plainText: "Hello", richText: "<i>Hello</i>", assStyle: null, speaker: null, alignmentConfidence: 0, qaStatus: "needs_review" as const, qaReason: "Alignment confidence fell below the 75% QA threshold.", sourceMetadata: null, createdAt: new Date(), updatedAt: new Date() }],
  translations: [],
  runs: [], assignments: [], comments: [], history: [], memberships: [], invitations: [], activities: [], auditEvents: [], notificationPreference: null,
};

function authenticatedContext(): TrpcContext {
  return {
    user: { id: 42, openId: "studio-user", name: "Studio User", email: "studio@example.com", loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("studio router", () => {
  it("requires an authenticated user before listing subtitle projects", async () => {
    const caller = appRouter.createCaller({ ...authenticatedContext(), user: null });
    await expect(caller.studio.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("requires authentication before reading project review history", async () => {
    const caller = appRouter.createCaller({ ...authenticatedContext(), user: null });
    await expect(caller.studio.get({ projectId: "project-1" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("requires authentication before adding reviewer comments", async () => {
    const caller = appRouter.createCaller({ ...authenticatedContext(), user: null });
    await expect(caller.studio.addCueComment({ projectId: "project-1", cueId: "cue-1", body: "Untrusted note" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("requires authentication before saving notification preferences", async () => {
    const caller = appRouter.createCaller({ ...authenticatedContext(), user: null });
    await expect(caller.studio.saveNotificationPreferences({ projectId: "project-1", inviteEvents: true, qaEvents: true, deliveryEvents: true, exportEvents: true, auditEvents: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("creates a user-owned session through the project API", async () => {
    db.getProjectEditorData.mockResolvedValue(editorData);
    const result = await appRouter.createCaller(authenticatedContext()).studio.create({ title: "Episode 03", sourceLanguage: "en" });
    expect(db.createSubtitleProject).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, title: "Episode 03", sourceLanguage: "en", status: "draft" }));
    expect(result.project.id).toBe("project-1");
  });

  it("serializes and records a style-preserving SRT export", async () => {
    db.getProjectEditorData.mockResolvedValue(editorData);
    storage.storagePut.mockResolvedValue({ key: "exports/master.srt", url: "/manus-storage/exports/master.srt" });
    const result = await appRouter.createCaller(authenticatedContext()).studio.export({ projectId: "project-1", trackId: "track-1", format: "srt" });
    expect(storage.storagePut).toHaveBeenCalledWith(expect.stringContaining("exports"), expect.stringContaining("<i>Hello</i>"), "application/x-subrip");
    expect(db.createMediaAsset).toHaveBeenCalledWith(expect.objectContaining({ kind: "export", filename: "master-dialogue-en.srt" }));
    expect(result).toEqual({ filename: "master-dialogue-en.srt", url: "/manus-storage/exports/master.srt" });
  });

  it("records a signed audit event and in-app activity for an approved subtitle export", async () => {
    db.getProjectEditorData.mockResolvedValue(editorData);
    storage.storagePut.mockResolvedValue({ key: "exports/master.srt", url: "/manus-storage/exports/master.srt" });
    await appRouter.createCaller(authenticatedContext()).studio.export({ projectId: "project-1", trackId: "track-1", format: "srt" });
    expect(db.createDeliveryAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", action: "subtitle_exported", payloadDigest: expect.stringMatching(/^[a-f0-9]{64}$/), signature: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(db.createProjectActivity).toHaveBeenCalledWith(expect.objectContaining({ eventType: "subtitle_exported" }));
  });

  it("blocks subtitle delivery until producer approval", async () => {
    db.getProjectEditorData.mockResolvedValue({ ...editorData, project: { ...editorData.project, deliveryStatus: "draft" } });
    await expect(appRouter.createCaller(authenticatedContext()).studio.export({ projectId: "project-1", trackId: "track-1", format: "srt" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("creates a time-limited collaborator invitation for the project owner", async () => {
    db.getProjectEditorData.mockResolvedValue(editorData);
    const result = await appRouter.createCaller(authenticatedContext()).studio.inviteCollaborator({ projectId: "project-1", email: "reviewer@example.com", role: "reviewer" });
    expect(emailDelivery.sendInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "reviewer@example.com", role: "reviewer" }));
    expect(db.createProjectInvitation).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", email: "reviewer@example.com", role: "reviewer", invitedByUserId: 42, status: "pending", deliveryMode: "provider_email", deliveryStatus: "sent" }));
    expect(db.createProjectActivity).toHaveBeenCalledWith(expect.objectContaining({ eventType: "invitation_created", metadata: expect.objectContaining({ delivery: "provider_email" }) }));
    expect(ownerNotification.notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining("Collaborator invitation emailed") }));
    expect(result.token).toHaveLength(40);
  });

  it("suppresses an owner invitation alert when invite notifications are disabled", async () => {
    db.getProjectEditorData.mockResolvedValue(editorData);
    db.getOwnerNotificationPreference.mockResolvedValue({ inviteEvents: false, qaEvents: true, deliveryEvents: true, exportEvents: true, auditEvents: true });
    ownerNotification.notifyOwner.mockClear();
    await appRouter.createCaller(authenticatedContext()).studio.inviteCollaborator({ projectId: "project-1", email: "silent@example.com", role: "viewer" });
    expect(db.createProjectActivity).toHaveBeenCalledWith(expect.objectContaining({ eventType: "invitation_created" }));
    expect(ownerNotification.notifyOwner).not.toHaveBeenCalled();
  });

  it("records manual secure-link delivery after an owner copies an invitation", async () => {
    db.getProjectEditorData.mockResolvedValue({ ...editorData, invitations: [{ id: "invite-copy", email: "reviewer@example.com", status: "pending" }] });
    const result = await appRouter.createCaller(authenticatedContext()).studio.markInvitationLinkCopied({ projectId: "project-1", invitationId: "invite-copy" });
    expect(db.updateProjectInvitation).toHaveBeenCalledWith("invite-copy", expect.objectContaining({ deliveryStatus: "link_copied", deliveryMode: "link_copy" }));
    expect(result).toEqual({ success: true });
  });

  it("exports a producer-visible signed delivery ledger", async () => {
    db.getProjectEditorData.mockResolvedValue({ ...editorData, auditEvents: [{ id: "audit-1", action: "delivery_approved", actorName: "Studio User", createdAt: new Date("2026-08-21T12:00:00.000Z"), payloadDigest: "a".repeat(64), signature: "b".repeat(64) }] });
    storage.storagePut.mockResolvedValue({ key: "reports/audit.csv", url: "/manus-storage/reports/audit.csv" });
    const result = await appRouter.createCaller(authenticatedContext()).studio.exportDeliveryAudit({ projectId: "project-1" });
    expect(storage.storagePut).toHaveBeenCalledWith(expect.stringContaining("delivery-audit.csv"), expect.stringContaining("Payload digest"), "text/csv");
    expect(result.url).toBe("/manus-storage/reports/audit.csv");
  });

  it("accepts a valid email-bound invitation and creates a collaborator membership", async () => {
    db.getInvitationByToken.mockResolvedValue({ id: "invite-1", projectId: "project-1", email: "studio@example.com", role: "reviewer", token: "a".repeat(40), invitedByUserId: 7, status: "pending", expiresAt: new Date(Date.now() + 86_400_000) });
    const result = await appRouter.createCaller(authenticatedContext()).studio.acceptInvitation({ token: "a".repeat(40) });
    expect(db.createProjectMembership).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", userId: 42, role: "reviewer", invitedByUserId: 7 }));
    expect(db.updateProjectInvitation).toHaveBeenCalledWith("invite-1", expect.objectContaining({ status: "accepted", acceptedByUserId: 42 }));
    expect(result).toEqual({ projectId: "project-1", role: "reviewer" });
  });

  it("expires an invitation that is accepted after its deadline", async () => {
    db.getInvitationByToken.mockResolvedValue({ id: "invite-expired", projectId: "project-1", email: "studio@example.com", role: "reviewer", token: "b".repeat(40), invitedByUserId: 7, status: "pending", expiresAt: new Date(Date.now() - 1) });
    await expect(appRouter.createCaller(authenticatedContext()).studio.acceptInvitation({ token: "b".repeat(40) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.updateProjectInvitation).toHaveBeenCalledWith("invite-expired", { status: "expired" });
  });

  it("lets the owner revoke a pending invitation", async () => {
    db.getProjectEditorData.mockResolvedValue({ ...editorData, invitations: [{ id: "invite-revoke", status: "pending" }] });
    const result = await appRouter.createCaller(authenticatedContext()).studio.revokeInvitation({ projectId: "project-1", invitationId: "invite-revoke" });
    expect(db.updateProjectInvitation).toHaveBeenCalledWith("invite-revoke", { status: "revoked" });
    expect(result).toEqual({ success: true });
  });

  it("rejects reviewer actions for a viewer-only collaborator", async () => {
    db.getProjectEditorData.mockResolvedValue({ ...editorData, accessRole: "viewer" });
    await expect(appRouter.createCaller(authenticatedContext()).studio.updateCueQa({ projectId: "project-1", cueId: "cue-1", qaStatus: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("builds a downloadable producer QA report for a reviewer", async () => {
    db.getProjectEditorData.mockResolvedValue(editorData);
    storage.storagePut.mockResolvedValue({ key: "reports/master.csv", url: "/manus-storage/reports/master.csv" });
    const result = await appRouter.createCaller(authenticatedContext()).studio.exportQaReport({ projectId: "project-1", format: "csv" });
    expect(storage.storagePut).toHaveBeenCalledWith(expect.stringContaining("reports"), expect.stringContaining("Master Dialogue"), "text/csv");
    expect(result.url).toBe("/manus-storage/reports/master.csv");
  });

  it("records a cue-level QA approval through the protected studio API", async () => {
    db.getProjectEditorData.mockResolvedValue(editorData);
    const result = await appRouter.createCaller(authenticatedContext()).studio.updateCueQa({ projectId: "project-1", cueId: "cue-1", qaStatus: "approved" });
    expect(db.updateCue).toHaveBeenCalledWith("project-1", "cue-1", { qaStatus: "approved", qaReason: null });
    expect(result).toEqual({ success: true });
  });

  it("stores a reviewer note only after confirming project ownership", async () => {
    db.getProjectEditorData.mockResolvedValue(editorData);
    const result = await appRouter.createCaller(authenticatedContext()).studio.addCueComment({ projectId: "project-1", cueId: "cue-1", body: "Check the speaker handoff." });
    expect(db.createCueComment).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", cueId: "cue-1", authorUserId: 42, body: "Check the speaker handoff." }));
    expect(result).toEqual({ success: true });
  });

  it("persists a collaborator's project notification preferences", async () => {
    db.getProjectEditorData.mockResolvedValue(editorData);
    const result = await appRouter.createCaller(authenticatedContext()).studio.saveNotificationPreferences({ projectId: "project-1", inviteEvents: true, qaEvents: false, deliveryEvents: true, exportEvents: false, auditEvents: true });
    expect(db.upsertNotificationPreference).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", userId: 42, qaEvents: false, exportEvents: false }));
    expect(result).toEqual({ success: true });
  });

  it("filters signed audit entries by action and collaborator for reviewers", async () => {
    db.getProjectEditorData.mockResolvedValue({ ...editorData, auditEvents: [
      { id: "audit-1", action: "delivery_approved", actorName: "Mia Chen", createdAt: new Date(), payloadDigest: "a".repeat(64), signature: "b".repeat(64) },
      { id: "audit-2", action: "subtitle_exported", actorName: "Noah Lee", createdAt: new Date(), payloadDigest: "c".repeat(64), signature: "d".repeat(64) },
    ] });
    const result = await appRouter.createCaller(authenticatedContext()).studio.searchDeliveryAudit({ projectId: "project-1", action: "delivery_approved", collaborator: "mia" });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("audit-1");
  });
});
