export type QaReportData = {
  title: string;
  deliveryStatus: string;
  generatedAt: Date;
  cues: Array<{ id: string; sequence: number; startMs: number; endMs: number; plainText: string; alignmentConfidence: number; qaStatus: string; qaReason: string | null }>;
  assignments: Array<{ cueId: string; assigneeName: string }>;
  comments: Array<{ cueId: string; authorName: string; body: string }>;
};

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function timecode(ms: number) {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function buildQaCsv(report: QaReportData) {
  const assignmentByCue = new Map(report.assignments.map(item => [item.cueId, item.assigneeName]));
  const commentCount = new Map<string, number>();
  report.comments.forEach(comment => commentCount.set(comment.cueId, (commentCount.get(comment.cueId) || 0) + 1));
  const rows = [
    ["Project", report.title],
    ["Delivery approval", report.deliveryStatus],
    ["Generated", report.generatedAt.toISOString()],
    [],
    ["Cue", "In", "Out", "Dialogue", "Confidence", "QA status", "QA reason", "Assignee", "Comments"],
    ...report.cues.map(cue => [cue.sequence, timecode(cue.startMs), timecode(cue.endMs), cue.plainText, cue.alignmentConfidence, cue.qaStatus, cue.qaReason || "", assignmentByCue.get(cue.id) || "", commentCount.get(cue.id) || 0]),
  ];
  return rows.map(row => row.map(csvCell).join(",")).join("\n") + "\n";
}

function pdfEscape(value: string) { return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }

export function buildQaPdf(report: QaReportData) {
  const flagged = report.cues.filter(cue => cue.qaStatus === "needs_review").length;
  const lines = [
    "SYNCFORGE STUDIO · QA DELIVERY REPORT",
    `Project: ${report.title}`,
    `Delivery approval: ${report.deliveryStatus.toUpperCase()} · Generated: ${report.generatedAt.toISOString()}`,
    `Cues: ${report.cues.length} · Flagged: ${flagged} · Assignments: ${report.assignments.length} · Notes: ${report.comments.length}`,
    "",
    ...report.cues.slice(0, 80).map(cue => `${String(cue.sequence).padStart(3, "0")}  ${timecode(cue.startMs)}–${timecode(cue.endMs)}  ${cue.qaStatus.toUpperCase()}  ${cue.plainText.slice(0, 110)}`),
  ];
  const content = ["BT", "/F1 11 Tf", "42 760 Td", "14 TL", ...lines.flatMap((line, index) => [index ? "T*" : "", `(${pdfEscape(line)}) Tj`].filter(Boolean)), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, "utf-8");
}
