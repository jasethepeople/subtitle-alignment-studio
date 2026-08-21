import type { Express, Request, Response } from "express";
import { nanoid } from "nanoid";
import { createMediaAsset, createSubtitleTrack, getProjectForUser, replaceTrackCues, updateSubtitleProject } from "./db";
import { sdk } from "./_core/sdk";
import { storagePut } from "./storage";
import { parseSubtitle } from "./subtitles";

const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;
const validExtensions = new Set(["mp4", "mkv", "srt", "ass"]);

function fileExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() || "";
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "upload";
}

export function registerMediaUploadRoutes(app: Express) {
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
