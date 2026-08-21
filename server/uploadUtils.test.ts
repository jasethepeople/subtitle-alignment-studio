import { describe, expect, it } from "vitest";
import { completeUploadPartNumbers, createUploadPlan, expectedPartSize, uploadPartId } from "./uploadUtils";

describe("resumable upload planning", () => {
  it("derives stable chunk requirements and detects missing parts", () => {
    const plan = createUploadPlan(20, 8);
    expect(plan).toEqual({ chunkSize: 8, totalParts: 3 });
    expect(expectedPartSize(20, 8, 3, 3)).toBe(4);
    expect(completeUploadPartNumbers([1, 3], 3)).toEqual([2]);
    expect(uploadPartId("session-1", 4)).toBe("session-1-000004");
  });
});
