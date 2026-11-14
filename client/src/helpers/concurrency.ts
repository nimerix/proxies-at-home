const HARD_MAX_CONCURRENCY = 8;

export function resolveImageProcessingConcurrency(maxOverride?: number) {
  if (typeof maxOverride === "number" && maxOverride > 0) {
    return Math.max(1, Math.min(HARD_MAX_CONCURRENCY, Math.floor(maxOverride)));
  }
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.hardwareConcurrency === "number"
  ) {
    return Math.min(HARD_MAX_CONCURRENCY, navigator.hardwareConcurrency);
  }
  return 2;
}

export async function processWithConcurrency<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
  limit?: number,
  signal?: AbortSignal
) {
  if (!items.length) return;
  const maxWorkers = resolveImageProcessingConcurrency(limit);
  let nextIndex = 0;
  let failed = false;

  const run = async () => {
    while (true) {
      if (signal?.aborted || failed) return;
      const current = nextIndex++;
      if (current >= items.length) return;
      try {
        await worker(items[current], current);
      } catch (error) {
        failed = true;
        throw error;
      }
      if (signal?.aborted) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  };

  const runners = Array.from(
    { length: Math.min(maxWorkers, items.length) },
    run
  );
  const results = await Promise.allSettled(runners);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

// Limits independent lazy-preview requests as well as batch operations.
export function createTaskQueue(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= Math.max(1, limit))
      await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
