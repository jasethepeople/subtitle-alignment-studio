import { bigint, boolean, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const subtitleProjects = mysqlTable("subtitleProjects", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  sourceLanguage: varchar("sourceLanguage", { length: 16 }).default("auto").notNull(),
  status: mysqlEnum("status", ["draft", "queued", "processing", "ready", "attention", "failed"]).default("draft").notNull(),
  durationMs: int("durationMs"),
  activeTrackId: varchar("activeTrackId", { length: 36 }),
  uploadConcurrency: int("uploadConcurrency").default(2).notNull(),
  uploadRetryLimit: int("uploadRetryLimit").default(3).notNull(),
  deliveryStatus: mysqlEnum("deliveryStatus", ["draft", "in_review", "approved"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const mediaAssets = mysqlTable("mediaAssets", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("projectId", { length: 36 }).notNull(),
  kind: mysqlEnum("kind", ["video", "subtitle", "audio", "waveform", "transcription", "export"]).notNull(),
  storageKey: text("storageKey").notNull(),
  storageUrl: text("storageUrl").notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  sizeBytes: bigint("sizeBytes", { mode: "number" }),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const subtitleTracks = mysqlTable("subtitleTracks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("projectId", { length: 36 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  language: varchar("language", { length: 16 }).default("und").notNull(),
  format: mysqlEnum("format", ["srt", "ass"]).notNull(),
  isPrimary: boolean("isPrimary").default(false).notNull(),
  styleProfile: text("styleProfile"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const subtitleCues = mysqlTable("subtitleCues", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("projectId", { length: 36 }).notNull(),
  trackId: varchar("trackId", { length: 36 }).notNull(),
  sequence: int("sequence").notNull(),
  startMs: int("startMs").notNull(),
  endMs: int("endMs").notNull(),
  plainText: text("plainText").notNull(),
  richText: text("richText").notNull(),
  assStyle: varchar("assStyle", { length: 128 }),
  speaker: varchar("speaker", { length: 128 }),
  alignmentConfidence: int("alignmentConfidence").default(0).notNull(),
  qaStatus: mysqlEnum("qaStatus", ["clear", "needs_review", "approved"]).default("needs_review").notNull(),
  qaReason: text("qaReason"),
  sourceMetadata: json("sourceMetadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const translationRuns = mysqlTable("translationRuns", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("projectId", { length: 36 }).notNull(),
  sourceTrackId: varchar("sourceTrackId", { length: 36 }).notNull(),
  targetTrackId: varchar("targetTrackId", { length: 36 }),
  targetLanguage: varchar("targetLanguage", { length: 16 }).notNull(),
  model: varchar("model", { length: 128 }),
  status: mysqlEnum("status", ["queued", "processing", "ready", "failed"]).default("queued").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const processingRuns = mysqlTable("processingRuns", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("projectId", { length: 36 }).notNull(),
  type: mysqlEnum("type", ["parse", "waveform", "transcription", "alignment", "export"]).notNull(),
  status: mysqlEnum("status", ["queued", "processing", "ready", "failed"]).default("queued").notNull(),
  summary: text("summary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const uploadSessions = mysqlTable("uploadSessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("projectId", { length: 36 }).notNull(),
  userId: int("userId").notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  totalBytes: bigint("totalBytes", { mode: "number" }).notNull(),
  chunkSize: int("chunkSize").notNull(),
  totalParts: int("totalParts").notNull(),
  status: mysqlEnum("status", ["uploading", "assembling", "completed", "failed"]).default("uploading").notNull(),
  finalAssetId: varchar("finalAssetId", { length: 36 }),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const uploadParts = mysqlTable("uploadParts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  sessionId: varchar("sessionId", { length: 36 }).notNull(),
  partNumber: int("partNumber").notNull(),
  storageKey: text("storageKey").notNull(),
  sizeBytes: bigint("sizeBytes", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const cueAssignments = mysqlTable("cueAssignments", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("projectId", { length: 36 }).notNull(),
  cueId: varchar("cueId", { length: 36 }).notNull(),
  assigneeUserId: int("assigneeUserId"),
  assigneeName: varchar("assigneeName", { length: 128 }).notNull(),
  assignedByUserId: int("assignedByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const cueComments = mysqlTable("cueComments", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("projectId", { length: 36 }).notNull(),
  cueId: varchar("cueId", { length: 36 }).notNull(),
  authorUserId: int("authorUserId").notNull(),
  authorName: varchar("authorName", { length: 128 }).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const cueStatusHistory = mysqlTable("cueStatusHistory", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("projectId", { length: 36 }).notNull(),
  cueId: varchar("cueId", { length: 36 }).notNull(),
  previousStatus: mysqlEnum("previousStatus", ["clear", "needs_review", "approved"]),
  nextStatus: mysqlEnum("nextStatus", ["clear", "needs_review", "approved"]).notNull(),
  reason: text("reason"),
  changedByUserId: int("changedByUserId"),
  changedByName: varchar("changedByName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const projectMemberships = mysqlTable("projectMemberships", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("projectId", { length: 36 }).notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["producer", "reviewer", "viewer"]).notNull(),
  invitedByUserId: int("invitedByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const projectInvitations = mysqlTable("projectInvitations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("projectId", { length: 36 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  role: mysqlEnum("role", ["producer", "reviewer", "viewer"]).notNull(),
  token: varchar("token", { length: 96 }).notNull().unique(),
  invitedByUserId: int("invitedByUserId").notNull(),
  status: mysqlEnum("status", ["pending", "accepted", "revoked", "expired"]).default("pending").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  acceptedAt: timestamp("acceptedAt"),
  acceptedByUserId: int("acceptedByUserId"),
  deliveryMode: mysqlEnum("deliveryMode", ["provider_email", "link_copy"]).default("link_copy").notNull(),
  deliveryStatus: mysqlEnum("deliveryStatus", ["deferred", "link_copied", "sent", "failed"]).default("deferred").notNull(),
  deliveredAt: timestamp("deliveredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const projectActivities = mysqlTable("projectActivities", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("projectId", { length: 36 }).notNull(),
  eventType: mysqlEnum("eventType", ["invitation_created", "invitation_accepted", "invitation_revoked", "qa_completed", "delivery_submitted", "delivery_approved", "subtitle_exported", "report_exported"]).notNull(),
  actorUserId: int("actorUserId"),
  actorName: varchar("actorName", { length: 128 }),
  recipientUserId: int("recipientUserId"),
  title: varchar("title", { length: 180 }).notNull(),
  body: text("body").notNull(),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const deliveryAuditEvents = mysqlTable("deliveryAuditEvents", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("projectId", { length: 36 }).notNull(),
  action: mysqlEnum("action", ["approval_requested", "delivery_approved", "subtitle_exported"]).notNull(),
  actorUserId: int("actorUserId").notNull(),
  actorName: varchar("actorName", { length: 128 }).notNull(),
  payload: json("payload").notNull(),
  payloadDigest: varchar("payloadDigest", { length: 64 }).notNull(),
  signature: varchar("signature", { length: 128 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SubtitleProject = typeof subtitleProjects.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
export type SubtitleTrack = typeof subtitleTracks.$inferSelect;
export type SubtitleCue = typeof subtitleCues.$inferSelect;
