import { expect, it } from "vitest";
import { createTaskQueue, processWithConcurrency } from "./concurrency";

it("bounds independent tasks and recovers slots after failures", async () => {
  const queue = createTaskQueue(3);
  let active = 0,
    maximum = 0,
    finished = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) =>
      queue(async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        finished++;
        if (i === 1) throw new Error("source failed");
        return i;
      })
    )
  );
  expect(maximum).toBe(3);
  expect(finished).toBe(12);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
it("drains already-running work but stops scheduling after a batch failure", async () => {
  const started: number[] = [],
    finished: number[] = [];
  await expect(
    processWithConcurrency(
      [0, 1, 2, 3, 4],
      async (i) => {
        started.push(i);
        if (i === 0) throw new Error("failed");
        await new Promise((resolve) => setTimeout(resolve, 5));
        finished.push(i);
      },
      2
    )
  ).rejects.toThrow("failed");
  expect(started).toEqual([0, 1]);
  expect(finished).toEqual([1]);
});
