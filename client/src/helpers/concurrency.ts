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
  const maxWorkers = Math.max(1, limit ?? resolveImageProcessingConcurrency());
  let nextIndex = 0;

  const run = async () => {
    while (true) {
      if (signal?.aborted) return;
      const current = nextIndex++;
      if (current >= items.length) return;
      await worker(items[current], current);
      if (signal?.aborted) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  };

  const runners = Array.from({ length: Math.min(maxWorkers, items.length) }, run);
  await Promise.all(runners);
}
