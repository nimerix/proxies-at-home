import type { BleedReport } from "./bleedReport";

export type Preview = { src: string; report?: BleedReport };
type Entry = {
  controller: AbortController;
  promise: Promise<Preview>;
  waiting: number;
  preview?: Preview;
};

const entries = new Map<string, Entry>();
const fileIds = new WeakMap<File, number>();
let nextFileId = 1;

export function previewSourceKey(source: string | File) {
  if (typeof source === "string") return source;
  let id = fileIds.get(source);
  if (!id) fileIds.set(source, (id = nextFileId++));
  return `file:${id}`;
}

/** Identical renders in progress, or still shown on another card, are shared.
 * A shared render is cancelled only when every caller has cancelled. */
export function cachedPreview(
  key: string,
  render: (signal: AbortSignal) => Promise<Preview>,
  isShown: (key: string) => boolean,
  signal?: AbortSignal
): Promise<Preview> {
  signal?.throwIfAborted();
  let entry = entries.get(key);
  if (entry?.preview && !isShown(key)) entry = undefined;
  if (!entry) {
    const controller = new AbortController();
    const created: Entry = {
      controller,
      waiting: 0,
      promise: Promise.resolve()
        .then(() => render(controller.signal))
        .then((preview) => {
          controller.signal.throwIfAborted();
          return (created.preview = preview);
        })
        .catch((error: unknown) => {
          if (entries.get(key) === created) entries.delete(key);
          throw error;
        }),
    };
    entries.set(key, (entry = created));
  }
  const current = entry;
  current.waiting++;
  return new Promise<Preview>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      current.waiting--;
      signal?.removeEventListener("abort", abort);
      return true;
    };
    const abort = () => {
      if (!finish()) return;
      if (!current.waiting && !current.preview) {
        current.controller.abort(signal!.reason);
        if (entries.get(key) === current) entries.delete(key);
      }
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    current.promise.then(
      (preview) => {
        if (finish()) resolve(preview);
      },
      (error: unknown) => {
        if (finish()) reject(error);
      }
    );
  });
}

/** Forget finished previews that no card shows any more. */
export function prunePreviews(isShown: (key: string) => boolean) {
  for (const [key, entry] of entries)
    if (entry.preview && !entry.waiting && !isShown(key)) entries.delete(key);
}
