import { describe, expect, it } from "vitest";
import { activityPresentation } from "./activityFeed";

describe("activity feed presentation", () => {
  it("makes deferred invitation delivery explicit in the activity feed", () => {
    const presentation = activityPresentation({ eventType: "invitation_created", title: "Invite prepared", body: "Outbound email delivery is deferred until a provider key is configured.", createdAt: "2026-08-21T12:00:00.000Z" });
    expect(presentation.tone).toBe("amber");
    expect(presentation.body).toContain("Copy the secure invitation link");
  });
});
