import {
  renderPreparedCard,
  canvasToBlob,
  type PreparedCardSource,
} from "./canvasProcessing";
import type { BleedArtworkOptions } from "./bleedArtwork";
import type { BleedReport } from "./bleedReport";

export type RenderWorkerRequest = {
  id: number;
  source: PreparedCardSource;
  bleedMm: number;
  hasBakedBleed: boolean;
  dpi: number;
  artwork?: BleedArtworkOptions;
  quality: number;
  type: "image/jpeg" | "image/png";
};
export type RenderWorkerResponse = { id: number } & (
  | { kind: "done"; blob: Blob; report?: BleedReport }
  | { kind: "unsupported" }
  | { kind: "error"; message: string }
);

let canvasSupported: boolean | undefined;
function supportsWorkerCanvas() {
  if (canvasSupported !== undefined) return canvasSupported;
  if (typeof OffscreenCanvas === "undefined") return (canvasSupported = false);
  let probe: OffscreenCanvas | undefined;
  try {
    probe = new OffscreenCanvas(1, 1);
    return (canvasSupported = !!probe.getContext("2d"));
  } catch {
    return (canvasSupported = false);
  } finally {
    if (probe) probe.width = probe.height = 0;
  }
}

async function renderRequest(
  request: RenderWorkerRequest
): Promise<RenderWorkerResponse> {
  const { id, source } = request;
  let canvas: Awaited<ReturnType<typeof renderPreparedCard>> | undefined;
  try {
    if (!supportsWorkerCanvas()) return { id, kind: "unsupported" };
    const { bleedMm, hasBakedBleed, dpi, artwork, quality, type } = request;
    let report: BleedReport | undefined;
    canvas = await renderPreparedCard(source, bleedMm, hasBakedBleed, dpi, {
      artwork,
      onReport: (value) => {
        report = value;
      },
    });
    return {
      id,
      kind: "done",
      blob: await canvasToBlob(canvas, type, quality),
      report,
    };
  } catch (error) {
    return {
      id,
      kind: "error",
      message:
        error instanceof Error
          ? error.message
          : "Could not prepare this image.",
    };
  } finally {
    source.interior.close();
    for (const band of source.bands) band.bitmap.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}

// Requests are serialized by the shared UI queue. Release every per-job resource
// before notifying it; termination cancels active work and discards the worker.
self.onmessage = async (event: MessageEvent<RenderWorkerRequest>) => {
  self.postMessage(await renderRequest(event.data));
};
