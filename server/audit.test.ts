import { describe, expect, it } from "vitest";
import { signAuditPayload, verifyAuditPayload } from "./audit";

describe("delivery audit signatures", () => {
  const payload = { projectId: "project-1", action: "delivery_approved", actorUserId: 42, actorName: "Producer", occurredAt: "2026-08-21T12:00:00.000Z", details: { format: "srt", cues: 12 } };

  it("verifies an intact signed audit event and detects tampering", () => {
    const signed = signAuditPayload(payload, "audit-test-secret");
    expect(signed.payloadDigest).toHaveLength(64);
    expect(verifyAuditPayload(payload, signed.signature, "audit-test-secret")).toBe(true);
    expect(verifyAuditPayload({ ...payload, details: { format: "ass", cues: 12 } }, signed.signature, "audit-test-secret")).toBe(false);
  });
});
