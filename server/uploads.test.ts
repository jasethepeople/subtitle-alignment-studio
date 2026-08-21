import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  createMediaAsset: vi.fn(), createSubtitleTrack: vi.fn(), createUploadSession: vi.fn(), getProjectForUser: vi.fn(),
  getUploadSessionForUser: vi.fn(), listUploadParts: vi.fn(), replaceTrackCues: vi.fn(), updateSubtitleProject: vi.fn(),
  updateUploadSession: vi.fn(), upsertUploadPart: vi.fn(),
}));
const storage = vi.hoisted(() => ({ storageGetSignedUrl: vi.fn(), storagePut: vi.fn(), storagePutStream: vi.fn() }));
const sdk = vi.hoisted(() => ({ authenticateRequest: vi.fn() }));

vi.mock("./db", () => db);
vi.mock("./storage", () => storage);
vi.mock("./_core/sdk", () => ({ sdk }));

import { registerMediaUploadRoutes } from "./uploads";

let server: Server;
let baseUrl = "";

const session = {
  id: "upload-1", projectId: "project-1", userId: 42, filename: "feature.mkv", mimeType: "video/x-matroska",
  totalBytes: 10, chunkSize: 10, totalParts: 1, status: "uploading" as const, finalAssetId: null, errorMessage: null,
  createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(async () => {
  vi.clearAllMocks();
  sdk.authenticateRequest.mockResolvedValue({ id: 42 });
  db.getProjectForUser.mockResolvedValue({ id: "project-1", userId: 42, sourceLanguage: "en" });
  db.createUploadSession.mockResolvedValue(session);
  db.getUploadSessionForUser.mockResolvedValue(session);
  storage.storagePutStream.mockResolvedValue({ key: "sources/feature.mkv", url: "/manus-storage/sources/feature.mkv" });
  const app = express();
  app.use(express.json());
  registerMediaUploadRoutes(app);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => new Promise<void>(resolve => server.close(() => resolve())));

describe("resumable upload routes", () => {
  it("creates a persisted multipart session for a valid feature-length video", async () => {
    const response = await fetch(`${baseUrl}/api/media-upload/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "project-1", filename: "feature.mkv", totalBytes: 10 }) });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: expect.any(String), totalParts: 1 });
    expect(db.createUploadSession).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", userId: 42, filename: "feature.mkv", totalBytes: 10 }));
  });

  it("rejects finalization when one or more upload parts are missing", async () => {
    db.listUploadParts.mockResolvedValue([]);
    const response = await fetch(`${baseUrl}/api/media-upload/sessions/upload-1/complete`, { method: "POST" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ missingParts: [1] });
  });

  it("finalizes complete parts into an owned source-video asset", async () => {
    db.listUploadParts.mockResolvedValue([{ id: "upload-1-000001", sessionId: "upload-1", partNumber: 1, storageKey: "parts/1", sizeBytes: 10, createdAt: new Date() }]);
    const response = await fetch(`${baseUrl}/api/media-upload/sessions/upload-1/complete`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(db.createMediaAsset).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", kind: "video", filename: "feature.mkv", sizeBytes: 10 }));
    expect(db.updateUploadSession).toHaveBeenCalledWith("upload-1", expect.objectContaining({ status: "completed" }));
  });
});
