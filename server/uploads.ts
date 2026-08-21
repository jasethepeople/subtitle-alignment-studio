import type { Express, Request, Response } from "express";
import { nanoid } from "nanoid";
import { Readable } from "node:stream";
import { createMediaAsset, createSubtitleTrack, createUploadSession, getProjectForUser, getUploadSessionForUser, listUploadParts, replaceTrackCues, updateSubtitleProject, updateUploadSession, upsertUploadPart } from "./db";
import { sdk } from "./_core/sdk";
import { storageGetSignedUrl, storagePut, storagePutStream } from "./storage";
import { parseSubtitle } from "./subtitles";
import { completeUploadPartNumbers, createUploadPlan, expectedPartSize, uploadPartId } from "./uploadUtils";

const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 12 * 1024 * 1024 * 1024;
const validExtensions = new Set(["mp4", "mkv", "srt", "ass"]);

function fileExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() || "";
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "upload";
}

export function registerMediaUploadRoutes(app: Express) {
  app.post("/api/media-upload/sessions", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const { projectId, filename: rawFilename, totalBytes } = req.body as { projectId?: string; filename?: string; totalBytes?: number };
      const filename = safeFilename(String(rawFilename || "upload"));
      const extension = fileExtension(filename);
      if (!projectId || !["mp4", "mkv"].includes(extension) || !Number.isSafeInteger(totalBytes) || totalBytes! <= 0 || totalBytes! > MAX_MULTIPART_BYTES) return res.status(400).json({ error: "Provide an MP4 or MKV source between 1 byte and 12 GB." });
      const project = await getProjectForUser(user.id, projectId);
      if (!project) return res.status(404).json({ error: "Project not found." });
      const plan = createUploadPlan(totalBytes!);
      const id = nanoid();
      const mimeType = extension === "mkv" ? "video/x-matroska" : "video/mp4";
      await createUploadSession({ id, projectId, userId: user.id, filename, mimeType, totalBytes: totalBytes!, ...plan, status: "uploading" });
      return res.status(201).json({ id, ...plan, uploadedParts: [] });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Could not create upload session." });
    }
  });

  app.get("/api/media-upload/sessions/:sessionId", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const session = await getUploadSessionForUser(user.id, req.params.sessionId);
      if (!session) return res.status(404).json({ error: "Upload session not found." });
      const parts = await listUploadParts(session.id);
      return res.json({ id: session.id, projectId: session.projectId, filename: session.filename, totalBytes: session.totalBytes, chunkSize: session.chunkSize, totalParts: session.totalParts, status: session.status, uploadedParts: parts.map(part => part.partNumber) });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Could not resume upload." });
    }
  });

  app.put("/api/media-upload/sessions/:sessionId/parts/:partNumber", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const session = await getUploadSessionForUser(user.id, req.params.sessionId);
      const partNumber = Number(req.params.partNumber);
      if (!session || session.status !== "uploading") return res.status(404).json({ error: "Active upload session not found." });
      const expected = expectedPartSize(session.totalBytes, session.chunkSize, partNumber, session.totalParts);
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of req) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += data.length;
        if (received > expected) return res.status(413).json({ error: "Upload part exceeds its expected byte range." });
        chunks.push(data);
      }
      if (received !== expected) return res.status(400).json({ error: `Part ${partNumber} is incomplete; expected ${expected} bytes.` });
      const stored = await storagePut(`projects/${session.projectId}/uploads/${session.id}/part-${String(partNumber).padStart(6, "0")}`, Buffer.concat(chunks), "application/octet-stream");
      await upsertUploadPart({ id: uploadPartId(session.id, partNumber), sessionId: session.id, partNumber, storageKey: stored.key, sizeBytes: received });
      return res.json({ partNumber, receivedBytes: received });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Could not save upload part." });
    }
  });

  app.post("/api/media-upload/sessions/:sessionId/complete", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const session = await getUploadSessionForUser(user.id, req.params.sessionId);
      if (!session || session.status !== "uploading") return res.status(404).json({ error: "Active upload session not found." });
      const parts = await listUploadParts(session.id);
      const missing = completeUploadPartNumbers(parts.map(part => part.partNumber), session.totalParts);
      if (missing.length) return res.status(409).json({ error: "Upload is not complete.", missingParts: missing });
      await updateUploadSession(session.id, { status: "assembling" });
      const source = Readable.from((async function* () {
        for (const part of parts) {
          const signedUrl = await storageGetSignedUrl(part.storageKey);
          const response = await fetch(signedUrl);
          if (!response.ok) throw new Error(`Could not read uploaded part ${part.partNumber}.`);
          yield Buffer.from(await response.arrayBuffer());
        }
      })());
      const stored = await storagePutStream(`projects/${session.projectId}/sources/${session.filename}`, source, session.mimeType);
      const assetId = nanoid();
      await createMediaAsset({ id: assetId, projectId: session.projectId, kind: "video", storageKey: stored.key, storageUrl: stored.url, filename: session.filename, mimeType: session.mimeType, sizeBytes: session.totalBytes, metadata: { resumableSessionId: session.id, totalParts: session.totalParts } });
      await updateUploadSession(session.id, { status: "completed", finalAssetId: assetId });
      await updateSubtitleProject(session.projectId, { status: "queued" });
      return res.json({ assetId, kind: "video", filename: session.filename, storageUrl: stored.url });
    } catch (error) {
      try { await updateUploadSession(req.params.sessionId, { status: "failed", errorMessage: error instanceof Error ? error.message : "Assembly failed." }); } catch { /* preserve original error */ }
      return res.status(500).json({ error: error instanceof Error ? error.message : "Could not assemble uploaded video." });
    }
  });

  app.post("/api/media-upload", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const projectId = String(req.header("x-project-id") || "");
      const filename = safeFilename(String(req.header("x-file-name") || "upload"));
      const kind = String(req.header("x-asset-kind") || "");
      const extension = fileExtension(filename);
      if (!projectId || !["video", "subtitle"].includes(kind) || !validExtensions.has(extension)) return res.status(400).json({ error: "Unsupported upload metadata." });
      if ((kind === "video" && !["mp4", "mkv"].includes(extension)) || (kind === "subtitle" && !["srt", "ass"].includes(extension))) return res.status(400).json({ error: "File type does not match the selected asset kind." });
      const project = await getProjectForUser(user.id, projectId);
      if (!project) return res.status(404).json({ error: "Project not found." });
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += data.length;
        if (bytes > MAX_UPLOAD_BYTES) return res.status(413).json({ error: "Uploads are limited to 45 MB for in-request media processing." });
        chunks.push(data);
      }
      const body = Buffer.concat(chunks);
      if (!body.length) return res.status(400).json({ error: "The upload is empty." });
      const mimeType = kind === "video" ? (extension === "mkv" ? "video/x-matroska" : "video/mp4") : (extension === "ass" ? "text/x-ssa" : "application/x-subrip");
      const stored = await storagePut(`projects/${projectId}/sources/${safeFilename(filename)}`, body, mimeType);
      const assetId = nanoid();
      await createMediaAsset({ id: assetId, projectId, kind: kind as "video" | "subtitle", storageKey: stored.key, storageUrl: stored.url, filename, mimeType, sizeBytes: body.length });
      if (kind === "subtitle") {
        const parsed = parseSubtitle(body.toString("utf-8"), filename);
        const trackId = nanoid();
        await createSubtitleTrack({ id: trackId, projectId, name: filename.replace(/\.(srt|ass)$/i, ""), language: project.sourceLanguage || "und", format: parsed.format, isPrimary: true, styleProfile: parsed.styleProfile || null });
        await replaceTrackCues(projectId, trackId, parsed.cues.map(cue => ({ id: nanoid(), projectId, trackId, ...cue, assStyle: cue.assStyle || null, speaker: cue.speaker || null, alignmentConfidence: 0, sourceMetadata: cue.sourceMetadata || null })));
        await updateSubtitleProject(projectId, { activeTrackId: trackId, status: "ready" });
        return res.json({ assetId, trackId, kind, filename, cueCount: parsed.cues.length });
      }
      await updateSubtitleProject(projectId, { status: "queued" });
      return res.json({ assetId, kind, filename });
    } catch (error) {
      console.error("[Upload] Failed:", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Upload failed." });
    }
  });
}
