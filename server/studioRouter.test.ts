import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const db = vi.hoisted(() => ({
  createCueComment: vi.fn(), createCueStatusHistory: vi.fn(), createMediaAsset: vi.fn(), createProcessingRun: vi.fn(), createProjectInvitation: vi.fn(), createProjectMembership: vi.fn(), createSubtitleProject: vi.fn(), createSubtitleTrack: vi.fn(), createTranslationRun: vi.fn(),
  deleteSubtitleProject: vi.fn(), getInvitationByToken: vi.fn(), getProjectEditorData: vi.fn(), listProjectsForUser: vi.fn(), replaceTrackCues: vi.fn(), updateCue: vi.fn(),
  updateProcessingRun: vi.fn(), updateProjectInvitation: vi.fn(), updateSubtitleProject: vi.fn(), updateTranslationRun: vi.fn(), upsertCueAssignment: vi.fn(),
}));
const storage = vi.hoisted(() => ({ storagePut: vi.fn() }));

vi.mock("./db", () => db);
vi.mock("./storage", () => storage);

import { appRouter } from "./routers";

const editorData = {
  project: { id: "project-1", userId: 42, title: "Master Dialogue", sourceLanguage: "en", status: "ready", deliveryStatus: "approved" as const, durationMs: 8_000, activeTrackId: "track-1", createdAt: new Date(), updatedAt: new Date() },
  accessRole: "owner" as const,
  assets: [],
  tracks: [{ id: "track-1", projectId: "project-1", name: "English", language: "en", format: "srt", isPrimary: true, styleProfile: null, createdAt: new Date(), updatedAt: new Date() }],
  cues: [{ id: "cue-1", projectId: "project-1", trackId: "track-1", sequence: 1, startMs: 1_000, endMs: 2_000, plainText: "Hello", richText: "<i>Hello</i>", assStyle: null, speaker: null, alignmentConfidence: 0, qaStatus: "needs_review" as const, qaReason: "Alignment confidence fell below the 75% QA threshold.", sourceMetadata: null, createdAt: new Date(), updatedAt: new Date() }],
  translations: [],
  runs: [], assignments: [], comments: [], history: [], memberships: [], invitations: [],
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

  it("blocks subtitle delivery until producer approval", async () => {
    db.getProjectEditorData.mockResolvedValue({ ...editorData, project: { ...editorData.project, deliveryStatus: "draft" } });
    await expect(appRouter.createCaller(authenticatedContext()).studio.export({ projectId: "project-1", trackId: "track-1", format: "srt" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("creates a time-limited collaborator invitation for the project owner", async () => {
    db.getProjectEditorData.mockResolvedValue(editorData);
    const result = await appRouter.createCaller(authenticatedContext()).studio.inviteCollaborator({ projectId: "project-1", email: "reviewer@example.com", role: "reviewer" });
    expect(db.createProjectInvitation).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", email: "reviewer@example.com", role: "reviewer", invitedByUserId: 42, status: "pending" }));
    expect(result.token).toHaveLength(40);
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
});
