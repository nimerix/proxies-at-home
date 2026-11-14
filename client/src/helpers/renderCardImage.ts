import {
  canvasToBlob,
  renderCardCanvas,
  prepareCardInterior,
  cardPerimeterPlan,
  type CardRenderOptions,
  type PerimeterBandLayout,
  type PreparedCardSource,
} from "./canvasProcessing";
import { createCanvas, getCanvasContext } from "./canvasSurface";
import { fetchImageBlob, loadImageElement } from "./imageUtils";
import type { BleedReport } from "./bleedReport";
import type {
  RenderWorkerRequest,
  RenderWorkerResponse,
} from "./cardRender.worker";

type RenderedImage = { blob: Blob; report?: BleedReport };
type RenderOptions = CardRenderOptions & {
  quality?: number;
  type?: "image/jpeg" | "image/png";
};
type QueuedRender = {
  run: () => Promise<RenderedImage>;
  resolve: (result: RenderedImage) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  abort: () => void;
};

// Preview and PDF callers share one decoded image/render at a time. Network
// fetching stays outside this queue, so slow downloads do not hold the worker.
const waiting: QueuedRender[] = [];
let rendering = false;
let sharedWorker: Worker | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let nextRequestId = 1;
const WORKER_IDLE_MS = 30000;
const WORKER_TIMEOUT_MS = 60000;

function abortReason(signal?: AbortSignal) {
  return signal?.reason ?? new DOMException("Aborted", "AbortError");
}

function startNextRender() {
  if (rendering) return;
  const job = waiting.shift();
  if (!job) return;
  job.signal?.removeEventListener("abort", job.abort);
  rendering = true;
  void (async () => {
    try {
      job.signal?.throwIfAborted();
      job.resolve(await job.run());
    } catch (error) {
      job.reject(error);
    } finally {
      rendering = false;
      startNextRender();
    }
  })();
}

function queueRender(run: QueuedRender["run"], signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<RenderedImage>((resolve, reject) => {
    const job: QueuedRender = {
      run,
      resolve,
      reject,
      signal,
      abort: () => {
        const index = waiting.indexOf(job);
        if (index >= 0) waiting.splice(index, 1);
        reject(abortReason(signal));
      },
    };
    signal?.addEventListener("abort", job.abort, { once: true });
    waiting.push(job);
    startNextRender();
  });
}

function discardWorker(worker: Worker) {
  if (sharedWorker !== worker) return;
  clearTimeout(idleTimer);
  idleTimer = undefined;
  sharedWorker = undefined;
  worker.onmessage = worker.onerror = worker.onmessageerror = null;
  worker.terminate();
}

function releaseWorker(worker: Worker) {
  // Keep no per-job closures or transferred resources on an idle worker.
  worker.onmessage = worker.onmessageerror = null;
  worker.onerror = (event) => {
    event.preventDefault();
    discardWorker(worker);
  };
  idleTimer = setTimeout(() => discardWorker(worker), WORKER_IDLE_MS);
}

function getWorker() {
  clearTimeout(idleTimer);
  idleTimer = undefined;
  if (!sharedWorker)
    sharedWorker = new Worker(
      new URL("./cardRender.worker.ts", import.meta.url),
      { type: "module" }
    );
  return sharedWorker;
}

/** A failed/aborted worker is never reused by the next queued request. */
function runWorker(
  request: Omit<RenderWorkerRequest, "id">,
  signal?: AbortSignal
): Promise<RenderedImage | null> {
  signal?.throwIfAborted();
  let worker: Worker;
  try {
    worker = getWorker();
  } catch {
    return Promise.resolve(null); // Worker creation may be blocked by policy.
  }
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (reuse: boolean) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (reuse) releaseWorker(worker);
      else discardWorker(worker);
      return true;
    };
    const abort = () => {
      if (finish(false)) reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      if (finish(false))
        reject(
          new Error("Image processing timed out. Try a lower export DPI.")
        );
    }, WORKER_TIMEOUT_MS);
    worker.onmessage = ({ data }: MessageEvent<RenderWorkerResponse>) => {
      if (data.id !== id) return;
      if (!finish(data.kind === "done")) return;
      if (data.kind === "done") resolve(data);
      else if (data.kind === "unsupported") resolve(null);
      else reject(new Error(data.message));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (finish(false)) resolve(null); // Module workers can also be blocked.
    };
    worker.onmessageerror = () => {
      if (finish(false)) resolve(null);
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      worker.postMessage({ ...request, id }, [
        request.source.interior,
        ...request.source.bands.map((band) => band.bitmap),
      ]);
    } catch {
      // Unsupported bitmap transfer is another capability failure; the source
      // has already decoded successfully and can use the canvas fallback.
      if (finish(false)) resolve(null);
    }
  });
}

async function createPerimeterBitmap(
  img: HTMLImageElement,
  rect: PerimeterBandLayout["source"],
  signal?: AbortSignal
) {
  const { x, y, width, height } = rect;
  signal?.throwIfAborted();
  // Cropping an HTML image directly to ImageBitmap can snapshot its entire
  // native backing in some browsers. Rasterize only the small band, also
  // supporting SVG inputs without a second source decode.
  const canvas = createCanvas(width, height);
  try {
    getCanvasContext(canvas).drawImage(
      img,
      x,
      y,
      width,
      height,
      0,
      0,
      width,
      height
    );
    return await createImageBitmap(canvas);
  } finally {
    canvas.width = canvas.height = 0;
  }
}

function closePreparedSource(source: PreparedCardSource) {
  source.interior.close();
  for (const band of source.bands) band.bitmap.close();
}

async function prepareWorkerSource(
  blob: Blob,
  bleedMm: number,
  hasBakedBleed: boolean,
  dpi: number,
  options: RenderOptions
): Promise<PreparedCardSource | null> {
  const objectUrl = URL.createObjectURL(blob);
  let img: HTMLImageElement | undefined;
  try {
    img = await loadImageElement(objectUrl, options.signal);
    // Source decoding failures are real input failures, not worker capability
    // failures. Let them propagate instead of decoding the same bad input again.
    await img.decode();
    options.signal?.throwIfAborted();
    let interior: ImageBitmap | undefined;
    const bands: PreparedCardSource["bands"] = [];
    try {
      const prepared = prepareCardInterior(
        img,
        bleedMm,
        hasBakedBleed,
        dpi,
        options.artwork
      );
      try {
        interior = await createImageBitmap(prepared);
      } finally {
        prepared.width = prepared.height = 0;
      }
      options.signal?.throwIfAborted();
      const nativeSize = { width: img.width, height: img.height };
      const plan = cardPerimeterPlan(
        nativeSize,
        bleedMm,
        hasBakedBleed,
        dpi,
        options.artwork
      );
      if (plan) {
        for (const { edge, source } of plan.bands) {
          // Resolved bitmap promises may otherwise keep all four copies in one
          // UI task. Give input and cancellation a turn between native bands.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          options.signal?.throwIfAborted();
          const bitmap = await createPerimeterBitmap(
            img,
            {
              ...source,
              x: plan.crop.x + source.x,
              y: plan.crop.y + source.y,
            },
            options.signal
          );
          bands.push({ edge, bitmap });
        }
      }
      options.signal?.throwIfAborted();
      return { kind: "prepared", ...nativeSize, interior, bands };
    } catch {
      interior?.close();
      for (const band of bands) band.bitmap.close();
      options.signal?.throwIfAborted();
      return null;
    }
  } finally {
    if (img) img.src = "";
    URL.revokeObjectURL(objectUrl);
  }
}

async function renderFetchedImage(
  blob: Blob,
  bleedMm: number,
  hasBakedBleed: boolean,
  dpi: number,
  options: RenderOptions
): Promise<RenderedImage> {
  const { signal, quality = 1, type = "image/jpeg" } = options;
  signal?.throwIfAborted();
  if (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap !== "undefined"
  ) {
    const source = await prepareWorkerSource(
      blob,
      bleedMm,
      hasBakedBleed,
      dpi,
      options
    );
    if (source) {
      try {
        const result = await runWorker(
          {
            source,
            bleedMm,
            hasBakedBleed,
            dpi,
            artwork: options.artwork,
            quality,
            type,
          },
          signal
        );
        signal?.throwIfAborted();
        if (result) {
          if (result.report) options.onReport?.(result.report);
          return result;
        }
      } finally {
        closePreparedSource(source);
      }
    }
  }
  // The original image and its URL were released before worker dispatch. Only
  // capability fallback creates a fresh URL from the same already-fetched blob.
  signal?.throwIfAborted();
  const objectUrl = URL.createObjectURL(blob);
  try {
    let report: BleedReport | undefined;
    const canvas = await renderCardCanvas(
      objectUrl,
      bleedMm,
      hasBakedBleed,
      dpi,
      {
        ...options,
        onReport: (value) => {
          report = value;
        },
      }
    );
    try {
      signal?.throwIfAborted();
      const encoded = await canvasToBlob(canvas, type, quality);
      signal?.throwIfAborted();
      if (report) options.onReport?.(report);
      return { blob: encoded, report };
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Render and encode with one shared, cancellable worker for previews and PDF. */
export async function renderCardImage(
  src: string,
  bleedMm: number,
  hasBakedBleed: boolean,
  dpi: number,
  options: RenderOptions = {}
): Promise<RenderedImage> {
  options.signal?.throwIfAborted();
  const blob = await fetchImageBlob(src, options.signal);
  return queueRender(
    () => renderFetchedImage(blob, bleedMm, hasBakedBleed, dpi, options),
    options.signal
  );
}
