import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  cueAssignments,
  cueComments,
  cueStatusHistory,
  InsertUser,
  mediaAssets,
  processingRuns,
  projectInvitations,
  projectMemberships,
  subtitleCues,
  subtitleProjects,
  subtitleTracks,
  translationRuns,
  uploadParts,
  uploadSessions,
  users,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

function requireDb<T>(db: T | null): T {
  if (!db) throw new Error("Database is unavailable. Please try again shortly.");
  return db;
}

export async function listProjectsForUser(userId: number) {
  const db = requireDb(await getDb());
  const [owned, memberships] = await Promise.all([
    db.select().from(subtitleProjects).where(eq(subtitleProjects.userId, userId)).orderBy(desc(subtitleProjects.updatedAt)),
    db.select().from(projectMemberships).where(eq(projectMemberships.userId, userId)),
  ]);
  const sharedIds = memberships.map(membership => membership.projectId).filter(projectId => !owned.some(project => project.id === projectId));
  if (!sharedIds.length) return owned;
  const shared = await db.select().from(subtitleProjects).where(inArray(subtitleProjects.id, sharedIds)).orderBy(desc(subtitleProjects.updatedAt));
  return [...owned, ...shared].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

export async function getProjectForUser(userId: number, projectId: string) {
  const db = requireDb(await getDb());
  const rows = await db.select().from(subtitleProjects).where(and(eq(subtitleProjects.userId, userId), eq(subtitleProjects.id, projectId))).limit(1);
  return rows[0];
}

export async function getProjectAccess(userId: number, projectId: string) {
  const db = requireDb(await getDb());
  const project = await getProjectForUser(userId, projectId);
  if (project) return { project, accessRole: "owner" as const, membership: undefined };
  const memberships = await db.select().from(projectMemberships).where(and(eq(projectMemberships.userId, userId), eq(projectMemberships.projectId, projectId))).limit(1);
  const membership = memberships[0];
  if (!membership) return undefined;
  const projects = await db.select().from(subtitleProjects).where(eq(subtitleProjects.id, projectId)).limit(1);
  return projects[0] ? { project: projects[0], accessRole: membership.role, membership } : undefined;
}

export async function createSubtitleProject(values: typeof subtitleProjects.$inferInsert) {
  const db = requireDb(await getDb());
  await db.insert(subtitleProjects).values(values);
  return getProjectForUser(values.userId, values.id);
}

export async function updateSubtitleProject(projectId: string, values: Partial<typeof subtitleProjects.$inferInsert>) {
  const db = requireDb(await getDb());
  await db.update(subtitleProjects).set(values).where(eq(subtitleProjects.id, projectId));
}

export async function deleteSubtitleProject(userId: number, projectId: string) {
  const db = requireDb(await getDb());
  const project = await getProjectForUser(userId, projectId);
  if (!project) return false;
  await db.delete(subtitleCues).where(eq(subtitleCues.projectId, projectId));
  await db.delete(subtitleTracks).where(eq(subtitleTracks.projectId, projectId));
  await db.delete(mediaAssets).where(eq(mediaAssets.projectId, projectId));
  await db.delete(translationRuns).where(eq(translationRuns.projectId, projectId));
  await db.delete(processingRuns).where(eq(processingRuns.projectId, projectId));
  await db.delete(cueAssignments).where(eq(cueAssignments.projectId, projectId));
  await db.delete(cueComments).where(eq(cueComments.projectId, projectId));
  await db.delete(cueStatusHistory).where(eq(cueStatusHistory.projectId, projectId));
  await db.delete(projectMemberships).where(eq(projectMemberships.projectId, projectId));
  await db.delete(projectInvitations).where(eq(projectInvitations.projectId, projectId));
  const sessions = await db.select({ id: uploadSessions.id }).from(uploadSessions).where(eq(uploadSessions.projectId, projectId));
  for (const session of sessions) await db.delete(uploadParts).where(eq(uploadParts.sessionId, session.id));
  await db.delete(uploadSessions).where(eq(uploadSessions.projectId, projectId));
  await db.delete(subtitleProjects).where(and(eq(subtitleProjects.id, projectId), eq(subtitleProjects.userId, userId)));
  return true;
}

export async function getProjectEditorData(userId: number, projectId: string) {
  const access = await getProjectAccess(userId, projectId);
  if (!access) return undefined;
  const { project, accessRole } = access;
  const db = requireDb(await getDb());
  const [assets, tracks, cues, translations, runs, assignments, comments, history, memberships, invitations] = await Promise.all([
    db.select().from(mediaAssets).where(eq(mediaAssets.projectId, projectId)),
    db.select().from(subtitleTracks).where(eq(subtitleTracks.projectId, projectId)),
    db.select().from(subtitleCues).where(eq(subtitleCues.projectId, projectId)).orderBy(subtitleCues.sequence),
    db.select().from(translationRuns).where(eq(translationRuns.projectId, projectId)).orderBy(desc(translationRuns.createdAt)),
    db.select().from(processingRuns).where(eq(processingRuns.projectId, projectId)).orderBy(desc(processingRuns.createdAt)),
    db.select().from(cueAssignments).where(eq(cueAssignments.projectId, projectId)).orderBy(desc(cueAssignments.updatedAt)),
    db.select().from(cueComments).where(eq(cueComments.projectId, projectId)).orderBy(desc(cueComments.createdAt)),
    db.select().from(cueStatusHistory).where(eq(cueStatusHistory.projectId, projectId)).orderBy(desc(cueStatusHistory.createdAt)),
    db.select().from(projectMemberships).where(eq(projectMemberships.projectId, projectId)).orderBy(desc(projectMemberships.createdAt)),
    db.select().from(projectInvitations).where(eq(projectInvitations.projectId, projectId)).orderBy(desc(projectInvitations.createdAt)),
  ]);
  return { project, accessRole, assets, tracks, cues, translations, runs, assignments, comments, history, memberships, invitations };
}

export async function createMediaAsset(values: typeof mediaAssets.$inferInsert) {
  const db = requireDb(await getDb());
  await db.insert(mediaAssets).values(values);
  return values;
}

export async function createSubtitleTrack(values: typeof subtitleTracks.$inferInsert) {
  const db = requireDb(await getDb());
  await db.insert(subtitleTracks).values(values);
  return values;
}

export async function replaceTrackCues(projectId: string, trackId: string, cues: Array<typeof subtitleCues.$inferInsert>) {
  const db = requireDb(await getDb());
  await db.delete(subtitleCues).where(and(eq(subtitleCues.projectId, projectId), eq(subtitleCues.trackId, trackId)));
  if (cues.length) await db.insert(subtitleCues).values(cues);
}

export async function updateCue(projectId: string, cueId: string, values: Partial<typeof subtitleCues.$inferInsert>) {
  const db = requireDb(await getDb());
  await db.update(subtitleCues).set(values).where(and(eq(subtitleCues.projectId, projectId), eq(subtitleCues.id, cueId)));
}

export async function createProcessingRun(values: typeof processingRuns.$inferInsert) {
  const db = requireDb(await getDb());
  await db.insert(processingRuns).values(values);
}

export async function updateProcessingRun(runId: string, values: Partial<typeof processingRuns.$inferInsert>) {
  const db = requireDb(await getDb());
  await db.update(processingRuns).set(values).where(eq(processingRuns.id, runId));
}

export async function createTranslationRun(values: typeof translationRuns.$inferInsert) {
  const db = requireDb(await getDb());
  await db.insert(translationRuns).values(values);
}

export async function updateTranslationRun(runId: string, values: Partial<typeof translationRuns.$inferInsert>) {
  const db = requireDb(await getDb());
  await db.update(translationRuns).set(values).where(eq(translationRuns.id, runId));
}

export async function createUploadSession(values: typeof uploadSessions.$inferInsert) {
  const db = requireDb(await getDb());
  await db.insert(uploadSessions).values(values);
  return getUploadSessionForUser(values.userId, values.id);
}

export async function getUploadSessionForUser(userId: number, sessionId: string) {
  const db = requireDb(await getDb());
  const rows = await db.select().from(uploadSessions).where(and(eq(uploadSessions.userId, userId), eq(uploadSessions.id, sessionId))).limit(1);
  return rows[0];
}

export async function listUploadParts(sessionId: string) {
  const db = requireDb(await getDb());
  return db.select().from(uploadParts).where(eq(uploadParts.sessionId, sessionId)).orderBy(asc(uploadParts.partNumber));
}

export async function upsertUploadPart(values: typeof uploadParts.$inferInsert) {
  const db = requireDb(await getDb());
  await db.insert(uploadParts).values(values).onDuplicateKeyUpdate({ set: { storageKey: values.storageKey, sizeBytes: values.sizeBytes } });
}

export async function updateUploadSession(sessionId: string, values: Partial<typeof uploadSessions.$inferInsert>) {
  const db = requireDb(await getDb());
  await db.update(uploadSessions).set(values).where(eq(uploadSessions.id, sessionId));
}

export async function upsertCueAssignment(values: typeof cueAssignments.$inferInsert) {
  const db = requireDb(await getDb());
  await db.insert(cueAssignments).values(values).onDuplicateKeyUpdate({ set: { assigneeUserId: values.assigneeUserId, assigneeName: values.assigneeName, assignedByUserId: values.assignedByUserId } });
}

export async function createCueComment(values: typeof cueComments.$inferInsert) {
  const db = requireDb(await getDb());
  await db.insert(cueComments).values(values);
}

export async function createCueStatusHistory(values: typeof cueStatusHistory.$inferInsert) {
  const db = requireDb(await getDb());
  await db.insert(cueStatusHistory).values(values);
}

export async function createProjectInvitation(values: typeof projectInvitations.$inferInsert) {
  const db = requireDb(await getDb());
  await db.insert(projectInvitations).values(values);
}

export async function getInvitationByToken(token: string) {
  const db = requireDb(await getDb());
  const rows = await db.select().from(projectInvitations).where(eq(projectInvitations.token, token)).limit(1);
  return rows[0];
}

export async function updateProjectInvitation(id: string, values: Partial<typeof projectInvitations.$inferInsert>) {
  const db = requireDb(await getDb());
  await db.update(projectInvitations).set(values).where(eq(projectInvitations.id, id));
}

export async function createProjectMembership(values: typeof projectMemberships.$inferInsert) {
  const db = requireDb(await getDb());
  await db.insert(projectMemberships).values(values);
}
