import {
  PROFILE_STEP_MM,
  WINDOW_HALF_MM,
  BLACK_MAX_CHANNEL,
  BLACK_MAX_CHROMA,
  AGED_BLACK_MAX_CHANNEL,
  AGED_BLACK_MAX_CHROMA,
  NEUTRAL_BLACK_MAX_CHROMA,
  DEEP_BLACK_MAX_CHANNEL,
  MIN_DARK_FRACTION,
  INK_STROKE_DEPTH_SAMPLES,
  WHITE_MIN_CHANNEL,
  WHITE_MAX_CHROMA,
  SAMPLE_STEP_MM,
  BAND_DEPTH_SAMPLES,
  SHALLOW_DEPTH_SAMPLES,
  MAX_AGED_BORDER_DEPTH_MM,
  BLACK_BOUNDARY_SEARCH_MM,
  INNER_ART_SAMPLES,
  INNER_BORDER_COLOR_DELTA,
  SCAN_NOISE_DELTA,
  MEDIAN_COLOR_TOLERANCE,
  MAX_ISOLATED_GRAIN_DELTA,
  straightBoundary,
} from "./bleedBorderPolicy";
import { CARD_H_MM, CARD_W_MM } from "../constants";
import {
  CARD_CORNER_RADIUS_MM,
  type ArtworkPixels,
  type ArtworkRegion,
} from "./bleedArtwork";
export { paintBorderBleed } from "./paintBleedBorders";
export {
  resolveBleedBorders,
  suggestedShadowRemoval,
} from "./resolveBleedBorders";

export type CardEdge = "top" | "bottom" | "left" | "right";
export type BorderProfile = {
  edge: CardEdge;
  lengthMm: number;
  points: {
    black: boolean;
    blackAtPoint: boolean;
    deepBlack: boolean;
    blackBoundaryMm: number;
    thinBlack: boolean;
    agedBlack: boolean;
    agedFrameTone: boolean;
    neutralBlack: boolean;
    agedPartialBlack: boolean;
    agedPartialAtPoint: boolean;
    agedBoundaryMm: number;
    white: boolean;
    shadowBlackInsetMm: number;
    shadowWhiteInsetMm: number;
  }[];
};
export type BleedBorders = {
  tone: 0 | 255;
  weights: Record<CardEdge, Float32Array>;
};

type ColorSample = {
  r: number;
  g: number;
  b: number;
  opaque: boolean;
  black: boolean;
  aged: boolean;
  white: boolean;
};

function classifyColor(
  r: number,
  g: number,
  b: number,
  opaque = true
): ColorSample {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    chroma = max - min;
  return {
    r,
    g,
    b,
    opaque,
    black: opaque && max <= BLACK_MAX_CHANNEL && chroma <= BLACK_MAX_CHROMA,
    aged:
      opaque &&
      max <= AGED_BLACK_MAX_CHANNEL &&
      chroma <= AGED_BLACK_MAX_CHROMA,
    white: opaque && min >= WHITE_MIN_CHANNEL && chroma <= WHITE_MAX_CHROMA,
  };
}
function classifySample(data: Uint8ClampedArray, p: number) {
  return classifyColor(data[p], data[p + 1], data[p + 2], data[p + 3] === 255);
}

type EdgeSampler = (along: number, depth: number) => ColorSample | null;
function createEdgeSampler(
  image: ArtworkPixels,
  region: ArtworkRegion,
  edge: CardEdge,
  dimensions: { width: number; height: number }
): EdgeSampler {
  const horizontal = edge === "top" || edge === "bottom";
  return (along, depth) => {
    const mx = horizontal
      ? along
      : edge === "left"
        ? depth
        : dimensions.width - depth;
    const my = horizontal
      ? edge === "top"
        ? depth
        : dimensions.height - depth
      : along;
    const x =
      Math.min(
        region.fullWidth - 1,
        Math.floor((mx * region.fullWidth) / dimensions.width)
      ) - region.x;
    const y =
      Math.min(
        region.fullHeight - 1,
        Math.floor((my * region.fullHeight) / dimensions.height)
      ) - region.y;
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
    return classifySample(image.data, (y * image.width + x) * 4);
  };
}

function hasTone(
  column: readonly (ColorSample | null)[],
  tone: "black" | "aged" | "white",
  count = column.length
) {
  for (let i = 0; i < count; i++) if (!column[i]?.[tone]) return false;
  return true;
}
function colorDistance(a: ColorSample | null, b: ColorSample | null) {
  if (!a?.opaque || !b?.opaque) return Infinity;
  return Math.max(
    Math.abs(a.r - b.r),
    Math.abs(a.g - b.g),
    Math.abs(a.b - b.b)
  );
}
function sampleChroma(sample: ColorSample) {
  return (
    Math.max(sample.r, sample.g, sample.b) -
    Math.min(sample.r, sample.g, sample.b)
  );
}
function medianReference(columns: readonly (ColorSample | null)[][]) {
  const samples = columns
    .flatMap((column) => column.slice(0, 3))
    .filter((s): s is ColorSample => !!s?.opaque);
  if (samples.length < 3) return null;
  const median = (channel: "r" | "g" | "b") =>
    samples.map((s) => s[channel]).sort((a, b) => a - b)[
      Math.floor(samples.length / 2)
    ];
  const reference = classifyColor(median("r"), median("g"), median("b"));
  // A median near the aged-color threshold still has sampling uncertainty.
  // Keep raw pixel limits strict; only the robust local reference gets slack.
  reference.aged =
    Math.max(reference.r, reference.g, reference.b) <=
      AGED_BLACK_MAX_CHANNEL + MEDIAN_COLOR_TOLERANCE &&
    sampleChroma(reference) <= AGED_BLACK_MAX_CHROMA + MEDIAN_COLOR_TOLERANCE;
  return reference;
}
function looksAged(sample: ColorSample | null, reference: ColorSample | null) {
  return (
    !!sample?.opaque &&
    (sample.aged ||
      (!!reference?.aged &&
        colorDistance(sample, reference) <= SCAN_NOISE_DELTA))
  );
}

function looksBlack(sample: ColorSample | null, reference: ColorSample | null) {
  return (
    !!sample?.opaque &&
    (sample.black ||
      (!!reference?.black &&
        colorDistance(sample, reference) <= SCAN_NOISE_DELTA))
  );
}

function classifyBand(
  columns: readonly (ColorSample | null)[][],
  insetMm: number,
  reference: ColorSample | null
) {
  let samples = 0,
    dark = 0,
    light = 0;
  const nonDarkCounts = columns.map((column) => {
    let nonDark = 0;
    for (const sample of column) {
      if (!sample) continue;
      samples++;
      if (looksAged(sample, reference)) {
        dark++;
      } else nonDark++;
      if (sample.white) light++;
    }
    return nonDark;
  });
  const boundaries = columns.map((column) => {
    const firstArt = column.findIndex(
      (sample) => !looksBlack(sample, reference)
    );
    return firstArt < 0 ? Infinity : insetMm + (firstArt + 1) * SAMPLE_STEP_MM;
  });
  const shallowBlack = columns.every((column) =>
    column
      .slice(0, SHALLOW_DEPTH_SAMPLES)
      .every((sample) => looksBlack(sample, reference))
  );
  return {
    black:
      samples > 0 &&
      (columns.every((column) =>
        column.every((sample) => looksBlack(sample, reference))
      ) ||
        (shallowBlack && straightBoundary(boundaries))),
    blackAtPoint:
      samples > 0 &&
      (columns[5].every((sample) => looksBlack(sample, reference)) ||
        (columns[5]
          .slice(0, SHALLOW_DEPTH_SAMPLES)
          .every((sample) => looksBlack(sample, reference)) &&
          Number.isFinite(boundaries[5]))),
    deepBlack:
      !!reference?.black &&
      Math.max(reference.r, reference.g, reference.b) <=
        DEEP_BLACK_MAX_CHANNEL &&
      sampleChroma(reference) <= NEUTRAL_BLACK_MAX_CHROMA,
    thinBlack: samples > 0 && shallowBlack && boundaries.every(Number.isFinite),
    // Full frames may contain isolated wear, but a stroke crossing the narrow
    // band still vetoes this local point. Whole-frame gap limits apply later.
    agedBlack:
      samples > 0 &&
      dark / samples >= MIN_DARK_FRACTION &&
      nonDarkCounts.every((count) => count < INK_STROKE_DEPTH_SAMPLES),
    agedFrameTone:
      isAgedFrameTone(reference) &&
      columns.every((column) => column.every((sample) => sample?.opaque)),
    neutralBlack:
      samples > 0 &&
      dark / samples >= MIN_DARK_FRACTION &&
      !!reference &&
      sampleChroma(reference) <= NEUTRAL_BLACK_MAX_CHROMA &&
      nonDarkCounts.every((count) => count < INK_STROKE_DEPTH_SAMPLES),
    white: samples > 0 && light / samples >= 0.95,
    shadowBlackInsetMm: shadowInset(columns, "aged", insetMm),
    shadowWhiteInsetMm: shadowInset(columns, "white", insetMm),
  };
}

function shadowInset(
  columns: readonly (ColorSample | null)[][],
  tone: "aged" | "white",
  insetMm: number
) {
  if (columns.every((column) => hasTone(column, tone))) return 0;
  for (let first = 1; first <= BAND_DEPTH_SAMPLES - INNER_ART_SAMPLES; first++)
    if (columns.every((column) => hasTone(column.slice(first), tone))) {
      const suggested =
        Math.ceil((insetMm + (first + 1) * SAMPLE_STEP_MM) * 10) / 10;
      return suggested <= 1 ? suggested : 0;
    }
  return 0;
}

function agedInnerBoundary(
  sample: EdgeSampler,
  along: number,
  insetMm: number,
  column: readonly (ColorSample | null)[],
  reference: ColorSample | null
) {
  const borderLike = (tone: ColorSample | null) =>
    looksAged(tone, reference) &&
    colorDistance(tone, reference) < INNER_BORDER_COLOR_DELTA;
  if (
    !reference?.aged ||
    !column.slice(0, SHALLOW_DEPTH_SAMPLES).every(borderLike)
  )
    return Infinity;
  // Confirmation may extend past the boundary limit; otherwise a nominal
  // 3.5 mm frame would be rejected from about 3.3 mm onward.
  const count =
    Math.floor((MAX_AGED_BORDER_DEPTH_MM - insetMm) / SAMPLE_STEP_MM + 1e-6) +
    INNER_ART_SAMPLES;
  let boundary = Infinity,
    artSamples = 0,
    outlierDistance = 0,
    outliers = 0;
  for (let i = 0; i < count; i++) {
    const depth = insetMm + (i + 1) * SAMPLE_STEP_MM;
    const tone = column[i] ?? sample(along, depth);
    if (!tone?.opaque) return Infinity;
    if (borderLike(tone)) {
      // One isolated grain speck is not an inner edge. Repeated ink remains a veto.
      if (artSamples) {
        if (
          artSamples > 1 ||
          outlierDistance > MAX_ISOLATED_GRAIN_DELTA ||
          ++outliers > 1
        )
          return Infinity;
        artSamples = 0;
        outlierDistance = 0;
        boundary = Infinity;
      }
      continue;
    }
    if (!artSamples) boundary = depth;
    outlierDistance = Math.max(outlierDistance, colorDistance(tone, reference));
    if (++artSamples === INNER_ART_SAMPLES)
      return boundary <= MAX_AGED_BORDER_DEPTH_MM + SAMPLE_STEP_MM + 1e-6
        ? boundary
        : Infinity;
  }
  return Infinity;
}

function blackInnerBoundary(
  sample: EdgeSampler,
  along: number,
  insetMm: number,
  reference: ColorSample | null
) {
  for (
    let depth = insetMm + SAMPLE_STEP_MM;
    depth <= BLACK_BOUNDARY_SEARCH_MM + 1e-6;
    depth += SAMPLE_STEP_MM
  ) {
    const tone = sample(along, depth);
    if (!tone?.opaque) return Infinity;
    if (!looksBlack(tone, reference)) return depth;
  }
  return Infinity;
}

/** Inspect a narrow, clean band rather than reflecting deeper art or lettering.
 * A wide dark window distinguishes partial borders from monochrome line art.
 * A shallow window can also establish a thin border spanning an entire edge.
 * White needs a wider band on all four edges.
 */
export function detectBorderProfile(
  image: ArtworkPixels,
  region: ArtworkRegion,
  edge: CardEdge,
  dimensions = { width: CARD_W_MM, height: CARD_H_MM },
  insetMm = 0.25
): BorderProfile {
  const horizontal = edge === "top" || edge === "bottom";
  const lengthMm = horizontal ? dimensions.width : dimensions.height;
  const count = Math.ceil(lengthMm / PROFILE_STEP_MM) + 1;
  const points: BorderProfile["points"] = Array.from({ length: count }, () => ({
    black: false,
    blackAtPoint: false,
    deepBlack: false,
    blackBoundaryMm: Infinity,
    thinBlack: false,
    agedBlack: false,
    agedFrameTone: false,
    neutralBlack: false,
    agedPartialBlack: false,
    agedPartialAtPoint: false,
    agedBoundaryMm: Infinity,
    white: false,
    shadowBlackInsetMm: 0,
    shadowWhiteInsetMm: 0,
  }));
  const tangent = CARD_CORNER_RADIUS_MM + WINDOW_HALF_MM;
  const sample = createEdgeSampler(image, region, edge, dimensions);
  for (let i = 0; i < count; i++) {
    const along = (i * lengthMm) / (count - 1);
    if (along < tangent || along > lengthMm - tangent) continue;
    const columns = Array.from({ length: 11 }, (_, offset) =>
      Array.from({ length: BAND_DEPTH_SAMPLES }, (_, depth) =>
        sample(
          along + (offset - 5) * SAMPLE_STEP_MM,
          insetMm + (depth + 1) * SAMPLE_STEP_MM
        )
      )
    );
    const reference = medianReference(columns);
    const agedBoundaries = columns.map((column, offset) =>
      agedInnerBoundary(
        sample,
        along + (offset - 5) * SAMPLE_STEP_MM,
        insetMm,
        column,
        reference
      )
    );
    points[i] = {
      ...classifyBand(columns, insetMm, reference),
      blackBoundaryMm: blackInnerBoundary(sample, along, insetMm, reference),
      // Warm/faded partial frames need a clean band and a real straight inner
      // boundary. Color alone can never promote an aged local artwork patch.
      agedPartialBlack:
        isAgedFrameTone(reference) && straightBoundary(agedBoundaries),
      agedPartialAtPoint:
        isAgedFrameTone(reference) && Number.isFinite(agedBoundaries[5]),
      agedBoundaryMm: agedBoundaries[5],
    };
  }
  return { edge, lengthMm, points };
}

function isAgedFrameTone(sample: ColorSample | null) {
  // Widening neutral-black chroma is for warm aging, not navy/green artwork.
  return (
    !!sample?.aged &&
    (sampleChroma(sample) <= BLACK_MAX_CHROMA ||
      (sample.r >= sample.g && sample.g >= sample.b))
  );
}
