import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const db = vi.hoisted(() => ({
  createMediaAsset: vi.fn(), createProcessingRun: vi.fn(), createSubtitleProject: vi.fn(), createSubtitleTrack: vi.fn(), createTranslationRun: vi.fn(),
  deleteSubtitleProject: vi.fn(), getProjectEditorData: vi.fn(), listProjectsForUser: vi.fn(), replaceTrackCues: vi.fn(), updateCue: vi.fn(),
  updateProcessingRun: vi.fn(), updateSubtitleProject: vi.fn(), updateTranslationRun: vi.fn(),
}));
const storage = vi.hoisted(() => ({ storagePut: vi.fn() }));

vi.mock("./db", () => db);
vi.mock("./storage", () => storage);

import { appRouter } from "./routers";

const editorData = {
  project: { id: "project-1", userId: 42, title: "Master Dialogue", sourceLanguage: "en", status: "ready", durationMs: 8_000, activeTrackId: "track-1", createdAt: new Date(), updatedAt: new Date() },
  assets: [],
  tracks: [{ id: "track-1", projectId: "project-1", name: "English", language: "en", format: "srt", isPrimary: true, styleProfile: null, createdAt: new Date(), updatedAt: new Date() }],
  cues: [{ id: "cue-1", projectId: "project-1", trackId: "track-1", sequence: 1, startMs: 1_000, endMs: 2_000, plainText: "Hello", richText: "<i>Hello</i>", assStyle: null, speaker: null, alignmentConfidence: 0, qaStatus: "needs_review" as const, qaReason: "Alignment confidence fell below the 75% QA threshold.", sourceMetadata: null, createdAt: new Date(), updatedAt: new Date() }],
  translations: [],
  runs: [],
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

  it("records a cue-level QA approval through the protected studio API", async () => {
    db.getProjectEditorData.mockResolvedValue(editorData);
    const result = await appRouter.createCaller(authenticatedContext()).studio.updateCueQa({ projectId: "project-1", cueId: "cue-1", qaStatus: "approved" });
    expect(db.updateCue).toHaveBeenCalledWith("project-1", "cue-1", { qaStatus: "approved", qaReason: null });
    expect(result).toEqual({ success: true });
  });
});
