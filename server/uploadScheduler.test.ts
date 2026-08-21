import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "../client/src/lib/uploadScheduler";

describe("bounded upload scheduling", () => {
  it("limits active chunk uploads while completing every queued part", async () => {
    let active = 0;
    let peak = 0;
    const completed: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async part => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      completed.push(part);
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(completed.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
