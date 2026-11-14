// Physical values are in millimeters; channel values are 8-bit RGB.

// Physical sampling and inner-boundary evidence
export const PROFILE_STEP_MM = 0.25; // Fixed physical grid, independent of output DPI.
export const WINDOW_HALF_MM = 0.5; // One millimeter of edge establishes local evidence.
export const SAMPLE_STEP_MM = 0.1;
export const BAND_DEPTH_SAMPLES = 6;
export const SHALLOW_DEPTH_SAMPLES = 2;
export const MAX_AGED_BORDER_DEPTH_MM = 3.5; // Find the inner boundary of ordinary 3 mm frames.
export const BLACK_BOUNDARY_SEARCH_MM = 4.5; // Fits the native 3.5 + 1 mm read band.
export const INNER_ART_SAMPLES = 3; // A 0.2 mm art continuation rules out a thin scratch.
export const INNER_BORDER_COLOR_DELTA = 24; // Confirm a material change, even into darker artwork.
export const THIN_BORDER_DEPTH_TOLERANCE_MM = 0.2; // Two depth samples of scan variation.

// Raw color evidence and ink protection
export const BLACK_MAX_CHANNEL = 96; // Local partial borders need conservative evidence.
export const BLACK_MAX_CHROMA = 24;
export const AGED_BLACK_MAX_CHANNEL = 112; // Structural frame evidence may support faded black.
export const AGED_BLACK_MAX_CHROMA = 40; // Or an aged warm cast in a confirmed frame.
export const NEUTRAL_BLACK_MAX_CHROMA = 15; // Colored dark art needs an actual frame boundary.
export const DEEP_BLACK_MAX_CHANNEL = 32; // Deeper partial regions must be genuinely near black.
export const WHITE_MIN_CHANNEL = 190; // Cream and aged white still represent white paper.
export const WHITE_MAX_CHROMA = 45;
export const MIN_DARK_FRACTION = 0.85; // Sparse wear specks may interrupt a black band.
export const INK_STROKE_DEPTH_SAMPLES = 4; // A stroke crossing the band is not a speck.

// Bounded RGB scan-grain tolerance
export const SCAN_NOISE_DELTA = 24; // Four standard deviations of six-level RGB scan grain.
export const MEDIAN_COLOR_TOLERANCE = 4; // Residual sampling error of the 33-pixel reference.
export const MAX_ISOLATED_GRAIN_DELTA = 32; // Larger contrast remains an ink veto.

// Run support, whole-frame wear and endpoint transition
export const MIN_BORDER_RUN_MM = 2; // Short runs need an adjoining long border.
export const INDEPENDENT_BORDER_RUN_MM = 8; // Reject isolated dark artwork pockets.
export const MAX_FRAME_WEAR_FRACTION = 0.03;
export const MIN_WORN_FRAME_SUPPORT = 0.9; // Supports surviving runs, never fills damaged gaps.
export const MAX_FRAME_WEAR_GAP_MM = 1.5; // A narrow scratch plus its 1 mm sampling window.
export const BORDER_END_TRANSITION_MM = 1; // Blend a border endpoint into nearby artwork.

export function straightBoundary(depths: readonly number[]) {
  const deepest = Math.max(...depths),
    shallowest = Math.min(...depths);
  return (
    Number.isFinite(deepest) &&
    deepest - shallowest <= THIN_BORDER_DEPTH_TOLERANCE_MM + 1e-6
  );
}
