import { afterEach, describe, expect, it, vi } from "vitest";
import { sendInvitationEmail } from "./email";

const originalFetch = global.fetch;

afterEach(() => { global.fetch = originalFetch; vi.unstubAllEnvs(); });

describe("verified invitation email delivery", () => {
  it("uses a verified Resend domain and reports provider delivery", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ name: "studio.example", status: "verified" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "email-123" }), { status: 200 }));
    await expect(sendInvitationEmail({ to: "reviewer@example.com", inviterName: "Mia", projectTitle: "Episode 3", role: "reviewer", inviteUrl: "https://studio.example/invite/token" })).resolves.toEqual({ delivered: true, providerId: "email-123" });
    expect(global.fetch).toHaveBeenLastCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
  });
});
