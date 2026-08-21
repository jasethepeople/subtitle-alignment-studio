export const RESUMABLE_CHUNK_SIZE = 8 * 1024 * 1024;

export function createUploadPlan(totalBytes: number, chunkSize = RESUMABLE_CHUNK_SIZE) {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) throw new Error("Upload size must be a positive integer.");
  return { chunkSize, totalParts: Math.ceil(totalBytes / chunkSize) };
}

export function expectedPartSize(totalBytes: number, chunkSize: number, partNumber: number, totalParts: number) {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > totalParts) throw new Error("Upload part number is outside the session range.");
  return partNumber === totalParts ? totalBytes - chunkSize * (totalParts - 1) : chunkSize;
}

export function uploadPartId(sessionId: string, partNumber: number) {
  return `${sessionId}-${String(partNumber).padStart(6, "0")}`;
}

export function completeUploadPartNumbers(received: number[], totalParts: number) {
  const unique = new Set(received);
  return Array.from({ length: totalParts }, (_, index) => index + 1).filter(part => !unique.has(part));
}
