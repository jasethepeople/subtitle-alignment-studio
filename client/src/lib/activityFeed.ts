export type ActivityFeedItem = { eventType: string; title: string; body: string; createdAt: Date | string };

export function activityPresentation(item: ActivityFeedItem) {
  const timestamp = new Date(item.createdAt).toLocaleString();
  if (item.eventType === "invitation_created" && /deferred/i.test(item.body)) {
    return { title: item.title, body: `${item.body} Copy the secure invitation link to deliver it manually.`, timestamp, tone: "amber" as const };
  }
  if (item.eventType === "delivery_approved") return { title: item.title, body: item.body, timestamp, tone: "emerald" as const };
  return { title: item.title, body: item.body, timestamp, tone: "sky" as const };
}
