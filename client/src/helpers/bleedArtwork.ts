import { CARD_H_MM, CARD_W_MM } from "../constants";

/** Physical artwork boundary, independent of the rectangular image file. */
export const CARD_CORNER_RADIUS_MM = 2.5;
export const MAX_SCAN_CORNER_RADIUS_MM = 3.5;
export const ALPHA_REPAIR_BAND_MM = 3.5;
export const ALPHA_SEARCH_MM = 1;
export const DEFAULT_SCAN_INSET_MM = 0.25;
export const MAX_SCAN_INSET_MM = 1;

export type BleedArtworkOptions = {
  /** Square digital artwork has no scanned corner or shadow to remove. */
  source: "scan" | "square";
  insetMm: number;
  /** Source cutout geometry; the physical card's trim radius stays 2.5 mm. */
  cornerRadiusMm?: number;
  borders?: "auto" | "mirror";
};

export const DEFAULT_BLEED_ARTWORK: BleedArtworkOptions = {
  source: "scan",
  insetMm: DEFAULT_SCAN_INSET_MM,
  cornerRadiusMm: CARD_CORNER_RADIUS_MM,
};

export type ArtworkPixels = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

/** Location of a source-resolution perimeter band in the full card raster. */
export type ArtworkRegion = {
  x: number;
  y: number;
  fullWidth: number;
  fullHeight: number;
};
export type RepairSpan = {
  y: number;
  height: number;
  left: number;
  right: number;
};

/**
 * Rebuild only the untrusted perimeter of a 63 × 88 mm scan, at source resolution.
 * The rounded rectangle is eroded, not scaled: trusted artwork stays in place.
 * All donors are in the unchanged interior, so the repair can safely run in place.
 */
export function repairScanPerimeter(
  image: ArtworkPixels,
  insetMm = DEFAULT_SCAN_INSET_MM,
  region?: ArtworkRegion,
  cornerRadiusMm = CARD_CORNER_RADIUS_MM
) {
  const steps = scanRepairSteps(image, insetMm, region, cornerRadiusMm);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** Cooperatively process large source bands so preview changes/cancel can run. */
export async function repairScanPerimeterAsync(
  image: ArtworkPixels,
  insetMm: number,
  region: ArtworkRegion,
  signal?: AbortSignal,
  cornerRadiusMm = CARD_CORNER_RADIUS_MM
) {
  const steps = scanRepairSteps(image, insetMm, region, cornerRadiusMm);
  let sliceStart = performance.now();
  for (;;) {
    signal?.throwIfAborted();
    const next = steps.next();
    if (next.done) return next.value;
    if (performance.now() - sliceStart >= 8) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      sliceStart = performance.now();
    }
  }
}

function* scanRepairSteps(
  image: ArtworkPixels,
  insetMm: number,
  region: ArtworkRegion | undefined,
  cornerRadiusMm: number
) {
  const { width, height, data } = image;
  const left = region?.x ?? 0,
    top = region?.y ?? 0;
  const fullWidth = region?.fullWidth ?? width,
    fullHeight = region?.fullHeight ?? height;
  const right = left + width,
    bottom = top + height;
  const inset = Number.isFinite(insetMm)
    ? Math.max(0, Math.min(MAX_SCAN_INSET_MM, insetMm))
    : DEFAULT_SCAN_INSET_MM;
  // Source geometry is explicit: opaque scanner bed can be pixel-identical to
  // legitimate white/black corner artwork, so color alone must not erase it.
  const radius = Number.isFinite(cornerRadiusMm)
    ? Math.max(
        CARD_CORNER_RADIUS_MM,
        Math.min(MAX_SCAN_CORNER_RADIUS_MM, cornerRadiusMm)
      )
    : CARD_CORNER_RADIUS_MM;
  const safeRadius = radius - inset;
  const mmX = CARD_W_MM / fullWidth;
  const mmY = CARD_H_MM / fullHeight;
  const safeRadiusSquared = safeRadius * safeRadius;
  // Join at or inside the straight-edge reflection radius. This keeps the
  // corner tangent continuous even with a 1 mm cleanup margin. The old
  // 1.4/0.9 mm limit is unchanged for margins up to 0.5 mm.
  const limitStart = Math.min(1.4, radius - 2 * inset);
  const limitSpan = Math.min(0.5, limitStart / 2);
  const limitFloor = limitStart === 1.4 ? 0.9 : limitStart - limitSpan;
  // A repaired alpha fringe must not become a donor for a later pixel.
  const opaque = new Uint8Array(width * height);
  for (let i = 0; i < opaque.length; i++)
    opaque[i] = data[i * 4 + 3] === 255 ? 1 : 0;

  function isTrusted(x: number, y: number) {
    if (x < 0 || y < 0 || x >= fullWidth || y >= fullHeight) return false;
    const px = (x + 0.5) * mmX;
    const py = (y + 0.5) * mmY;
    const dx = px - Math.max(radius, Math.min(CARD_W_MM - radius, px));
    const dy = py - Math.max(radius, Math.min(CARD_H_MM - radius, py));
    return dx * dx + dy * dy <= safeRadiusSquared;
  }

  function sample(x: number, y: number, destination: number) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    let total = 0,
      red = 0,
      green = 0,
      blue = 0;
    for (let oy = 0; oy < 2; oy++) {
      for (let ox = 0; ox < 2; ox++) {
        const sx = x0 + ox,
          sy = y0 + oy;
        if (sx < left || sy < top || sx >= right || sy >= bottom) continue;
        if (!isTrusted(sx, sy)) continue;
        const i = ((sy - top) * width + sx - left) * 4;
        // Transparent/antialiased scanner fringes must never become donors.
        if (!opaque[i / 4]) continue;
        const weight = (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy);
        total += weight;
        red += data[i] * weight;
        green += data[i + 1] * weight;
        blue += data[i + 2] * weight;
      }
    }
    if (total > 1e-8) {
      data[destination] = red / total;
      data[destination + 1] = green / total;
      data[destination + 2] = blue / total;
      data[destination + 3] = 255;
      return true;
    }
    return false;
  }

  const cornerRows = Math.ceil(ALPHA_REPAIR_BAND_MM / mmY);
  const edgeColumns = Math.ceil(ALPHA_REPAIR_BAND_MM / mmX);
  const spans: RepairSpan[] = [];
  for (let y = top; y < bottom; y++) {
    let repairLeft = 0,
      repairRight = fullWidth;
    const cornerRow = y < cornerRows || y >= fullHeight - cornerRows;
    for (let x = left; x < right; x++) {
      // Skip the interior in one jump; work scales with perimeter, not area.
      if (!cornerRow && x === edgeColumns)
        x = Math.min(right, fullWidth - edgeColumns);
      if (x >= right) continue;
      const destination = ((y - top) * width + x - left) * 4;
      const trusted = isTrusted(x, y);
      if (trusted && opaque[destination / 4]) continue;
      const px = (x + 0.5) * mmX,
        py = (y + 0.5) * mmY;
      if (
        trusted &&
        Math.min(px, py, CARD_W_MM - px, CARD_H_MM - py) > ALPHA_REPAIR_BAND_MM
      )
        continue;
      if (x < fullWidth / 2) repairLeft = Math.max(repairLeft, x + 1);
      else repairRight = Math.min(repairRight, x);
      let cx = Math.max(radius, Math.min(CARD_W_MM - radius, px));
      let cy = Math.max(radius, Math.min(CARD_H_MM - radius, py));
      // Transparent pixels just inside the nominal arc still need an inward
      // direction, including pixels beyond a corner tangent.
      if (cx === px && cy === py) {
        const nearest = Math.min(px, py, CARD_W_MM - px, CARD_H_MM - py);
        if (nearest === px) cx = px + 1;
        else if (nearest === CARD_W_MM - px) cx = px - 1;
        else if (nearest === py) cy = py + 1;
        else cy = py - 1;
      }
      const dx = px - cx,
        dy = py - cy;
      const distance = Math.hypot(dx, dy);
      const nx = dx / distance,
        ny = dy / distance;
      // Reflect through the clean boundary. A wider cleanup margin may send
      // a corner reflection through the curvature center; limit it below.
      let reflectedRadius = trusted ? distance : 2 * safeRadius - distance;
      // Value and slope match ordinary reflection at the limit. The primary
      // donor stays at least 0.25 mm from the center; straight edges never
      // enter this branch, because their reflected radius is >= limitStart.
      if (!trusted && reflectedRadius < limitStart)
        reflectedRadius =
          limitFloor +
          limitSpan * Math.exp((reflectedRadius - limitStart) / limitSpan);
      let sampled = false;
      // Usually one bilinear sample. Step inward only if all its taps are
      // unsafe/transparent, keeping the search local and strictly bounded.
      const pixelStep = Math.max(mmX, mmY);
      const searchLimit = Math.min(ALPHA_SEARCH_MM, reflectedRadius);
      for (let step = 0; step < 12 && !sampled; step++) {
        const advance =
          step === 0 ? 0 : Math.min(searchLimit, 2 ** (step - 1) * pixelStep);
        const r = reflectedRadius - advance;
        sampled = sample(
          (cx + nx * r) / mmX - 0.5,
          (cy + ny * r) / mmY - 0.5,
          destination
        );
        if (advance >= searchLimit) break;
      }
      if (!sampled) {
        // No opaque local artwork (e.g. an empty transparent upload).
        // White matches the printable page rather than leaking hidden RGB.
        data.fill(255, destination, destination + 4);
      }
    }
    if (repairLeft > 0 || repairRight < fullWidth) {
      const previous = spans.at(-1);
      if (
        previous &&
        previous.y + previous.height === y &&
        previous.left === repairLeft &&
        previous.right === repairRight
      )
        previous.height++;
      else spans.push({ y, height: 1, left: repairLeft, right: repairRight });
    }
    if ((y - top) % 8 === 7) yield;
  }
  return spans;
}
