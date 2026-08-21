type InvitationEmail = { to: string; inviterName: string; projectTitle: string; role: string; inviteUrl: string };
type EmailResult = { delivered: true; providerId?: string } | { delivered: false; error: string };

async function verifiedSenderDomain(apiKey: string) {
  const response = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) return undefined;
  const payload = await response.json() as { data?: Array<{ name: string; status: string }> };
  return payload.data?.find(domain => domain.status === "verified")?.name;
}

export async function sendInvitationEmail(input: InvitationEmail): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { delivered: false, error: "A Resend API key has not been configured." };
  const domain = await verifiedSenderDomain(apiKey);
  if (!domain) return { delivered: false, error: "No verified sending domain is available in the configured Resend account." };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `SyncForge Studio <invites@${domain}>`,
      to: [input.to],
      subject: `${input.inviterName} invited you to ${input.projectTitle}`,
      html: `<main style="font-family:Arial,sans-serif;line-height:1.55;color:#1b1d22"><h2>SyncForge Studio invitation</h2><p>${escapeHtml(input.inviterName)} invited you to collaborate on <strong>${escapeHtml(input.projectTitle)}</strong> as a <strong>${escapeHtml(input.role)}</strong>.</p><p><a href="${input.inviteUrl}" style="display:inline-block;padding:10px 16px;background:#39bcea;color:#081117;text-decoration:none;font-weight:700">Accept invitation</a></p><p>This link is email-bound and expires in seven days.</p></main>`,
    }),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok) return { delivered: false, error: payload.message || `Resend delivery failed (${response.status}).` };
  return { delivered: true, providerId: payload.id };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] || character);
}
