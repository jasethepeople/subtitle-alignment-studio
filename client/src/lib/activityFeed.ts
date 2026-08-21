export type ActivityFeedItem = { eventType: string; title: string; body: string; createdAt: Date | string };
export type ActivityPreferences = { inviteEvents: boolean; qaEvents: boolean; deliveryEvents: boolean; exportEvents: boolean; auditEvents: boolean };

export function isActivityEnabled(item: ActivityFeedItem, preferences: ActivityPreferences) {
  if (item.eventType.startsWith("invitation_")) return preferences.inviteEvents;
  if (item.eventType === "qa_completed") return preferences.qaEvents;
  if (item.eventType === "delivery_submitted" || item.eventType === "delivery_approved") return preferences.deliveryEvents;
  if (item.eventType === "subtitle_exported") return preferences.exportEvents;
  if (item.eventType === "report_exported") return preferences.auditEvents;
  return true;
}

export function activityPresentation(item: ActivityFeedItem) {
  const timestamp = new Date(item.createdAt).toLocaleString();
  if (item.eventType === "invitation_created" && /deferred/i.test(item.body)) {
    return { title: item.title, body: `${item.body} Copy the secure invitation link to deliver it manually.`, timestamp, tone: "amber" as const };
  }
  if (item.eventType === "delivery_approved") return { title: item.title, body: item.body, timestamp, tone: "emerald" as const };
  return { title: item.title, body: item.body, timestamp, tone: "sky" as const };
}
