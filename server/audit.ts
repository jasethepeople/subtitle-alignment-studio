import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ENV } from "./_core/env";

export type AuditPayload = { projectId: string; action: string; actorUserId: number; actorName: string; occurredAt: string; details: Record<string, unknown> };

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

export function signAuditPayload(payload: AuditPayload, secret = ENV.cookieSecret) {
  if (!secret) throw new Error("Audit signing secret is not configured.");
  const serialized = stable(payload);
  return { payloadDigest: createHash("sha256").update(serialized).digest("hex"), signature: createHmac("sha256", secret).update(serialized).digest("hex") };
}

export function verifyAuditPayload(payload: AuditPayload, signature: string, secret = ENV.cookieSecret) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = signAuditPayload(payload, secret).signature;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}
