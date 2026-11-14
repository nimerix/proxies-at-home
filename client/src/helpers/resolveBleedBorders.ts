import { CARD_CORNER_RADIUS_MM } from "./bleedArtwork";
import type { BorderProfile, BleedBorders, CardEdge } from "./bleedBorders";
import {
  WINDOW_HALF_MM,
  MIN_BORDER_RUN_MM,
  INDEPENDENT_BORDER_RUN_MM,
  BORDER_END_TRANSITION_MM,
  MAX_FRAME_WEAR_FRACTION,
  MIN_WORN_FRAME_SUPPORT,
  MAX_FRAME_WEAR_GAP_MM,
  straightBoundary,
} from "./bleedBorderPolicy";

/** Edge decision order (generated bleed only):
 * Evidence                         Treatment
 * Whole white frame                White on every edge
 * Whole aged neutral/colored frame Black, with bounded wear tolerance
 * Near-black or bounded dark run   Black when long or corner-supported
 * Aged run + stable inner boundary Black; isolated grain windows may join
 * Full shallow border              Black on that edge
 * Anything else                    Keep the mirrored artwork
 *
 * Colorful aged frames need an inner boundary on every edge. Other dark runs
 * need nearby artwork, near-black color, or corroboration from a worn frame.
 * Short neutral corner runs can use an independently accepted adjacent border.
 * Fine ink, non-opaque gaps and changing boundary depths veto grain joining.
 */
function profileRange(profile: BorderProfile) {
  const step = profile.lengthMm / (profile.points.length - 1);
  const start = Math.ceil((CARD_CORNER_RADIUS_MM + WINDOW_HALF_MM) / step);
  const end = Math.floor(
    (profile.lengthMm - CARD_CORNER_RADIUS_MM - WINDOW_HALF_MM) / step
  );
  return { step, start, end };
}

function blackRuns(
  profile: BorderProfile,
  kind: "black" | "agedPartialBlack" | "neutralBlack" = "black",
  wornFrame = false
) {
  const { step, start, end } = profileRange(profile);
  const confidence = profile.points.map((point) =>
    kind === "black"
      ? point.black && (point.deepBlack || point.agedPartialBlack)
      : kind === "neutralBlack"
        ? point.black && point.neutralBlack
        : point.agedPartialBlack
  );
  if (kind === "black") {
    for (let i = start; i <= end; ) {
      if (!profile.points[i].black) {
        i++;
        continue;
      }
      const first = i;
      while (i <= end && profile.points[i].black) i++;
      const run = profile.points.slice(first, i);
      // Text creates a ragged inner edge in real footers. A majority of
      // bounded neutral samples supports that run without treating deep
      // gray rock or navy sky as a border. A worn four-sided frame supplies
      // equivalent evidence, but its actual non-black gaps stay excluded.
      const bounded = run.filter(
        (point) => point.neutralBlack && Number.isFinite(point.blackBoundaryMm)
      );
      if (wornFrame || bounded.length >= run.length / 2)
        confidence.fill(true, first, i);
    }
  }
  if (kind === "agedPartialBlack") corroborateAgedGaps(profile, confidence);
  const runs: { first: number; last: number; length: number }[] = [];
  for (let i = start; i <= end; ) {
    if (!confidence[i]) {
      i++;
      continue;
    }
    const first = i;
    while (i <= end && confidence[i]) i++;
    const length = (i - first) * step;
    if (length >= MIN_BORDER_RUN_MM) runs.push({ first, last: i - 1, length });
  }
  return runs;
}

function corroborateAgedGaps(profile: BorderProfile, flags: boolean[]) {
  const { step, start, end } = profileRange(profile);
  for (let i = start; i <= end; ) {
    if (flags[i]) {
      i++;
      continue;
    }
    const first = i;
    while (i <= end && !flags[i]) i++;
    // A single 1 mm confidence window may fail on grain. Keep the run joined
    // only when its opaque warm/neutral band and inner depth remain supported.
    if (
      first === start ||
      i > end ||
      (i - first - 1) * step > WINDOW_HALF_MM * 2
    )
      continue;
    const neighbors = profile.points.slice(first - 1, i + 1);
    const depths = neighbors
      .map((point) => point.agedBoundaryMm)
      .filter(Number.isFinite);
    if (
      neighbors.every((point) => point.agedBlack && point.agedFrameTone) &&
      straightBoundary(depths)
    )
      flags.fill(true, first, i);
  }
}

function borderWeights(profile: BorderProfile, flags: boolean[]) {
  const { step, start, end } = profileRange(profile);
  flags.fill(flags[start], 0, start);
  flags.fill(flags[end], end + 1);
  const weights = new Float32Array(flags.length);
  for (let i = 0; i < flags.length; ) {
    if (!flags[i]) {
      i++;
      continue;
    }
    const first = i;
    while (i < flags.length && flags[i]) i++;
    // The confirmed black run stays fully black. Taper only beyond its end;
    // tapering inside it would reintroduce mirrored frame details at the edge.
    const padding = Math.ceil(BORDER_END_TRANSITION_MM / step) + 1;
    for (
      let j = Math.max(0, first - padding);
      j < Math.min(flags.length, i + padding);
      j++
    ) {
      const distance = Math.max(first - j - 1, j - i, 0) * step;
      const t = Math.max(0, 1 - distance / BORDER_END_TRANSITION_MM);
      weights[j] = Math.max(weights[j], t * t * (3 - 2 * t));
    }
  }
  return weights;
}

function hasContinuousFrame(
  profile: BorderProfile,
  kind: "agedBlack" | "neutralBlack" | "agedPartialBlack" | "white"
) {
  const { step, start, end } = profileRange(profile);
  let missed = 0,
    run = 0,
    maxRun = 0;
  for (let i = start; i <= end; i++) {
    if (!profile.points[i][kind]) {
      missed++;
      run++;
      maxRun = Math.max(maxRun, run);
    } else run = 0;
  }
  // One tiny wear scratch must not discard an otherwise complete frame.
  // Both limits matter: repeated fine ink and longer art breaks still fail.
  return (
    missed / (end - start + 1) <= MAX_FRAME_WEAR_FRACTION &&
    maxRun * step <= MAX_FRAME_WEAR_GAP_MM
  );
}

function hasColoredFrameBoundary(profile: BorderProfile) {
  const { start, end } = profileRange(profile);
  const band = profile.points.slice(start, end + 1);
  const boundaries = band.filter((point) => point.agedPartialBlack);
  // Whole-frame color continuity is already required. Boundary evidence can
  // skip corner tangencies and isolated specks, which invalidate an entire
  // 1 mm sampling window, but must cover most of each edge at a stable depth.
  return (
    boundaries.length / band.length >= 0.75 &&
    straightBoundary(boundaries.map((point) => point.agedBoundaryMm))
  );
}

/** Suggest, never silently apply, a larger margin when at least two matching
 * frame edges corroborate shallow discolored rims on the remaining edges. */
export function suggestedShadowRemoval(profiles: BorderProfile[]) {
  if (profiles.length !== 4) return undefined;
  for (const tone of ["agedBlack", "white"] as const) {
    const suspects = profiles.filter(
      (profile) => !hasContinuousFrame(profile, tone)
    );
    if (suspects.length < 1 || suspects.length > 2) continue;
    const hintsByEdge = suspects.map((suspect) => {
      const { start, end } = profileRange(suspect);
      return suspect.points
        .slice(start, end + 1)
        .map((point) =>
          tone === "white" ? point.shadowWhiteInsetMm : point.shadowBlackInsetMm
        );
    });
    if (
      hintsByEdge.every(
        (hints) =>
          hints.filter((inset) => inset > 0).length / hints.length >= 0.95
      )
    )
      return Math.max(...hintsByEdge.flat());
  }
  return undefined;
}

export function resolveBleedBorders(profiles: BorderProfile[]): BleedBorders {
  // Wear tolerance is reserved for a frame confirmed around the whole card.
  // Applying it to isolated local runs would erase sparse monochrome artwork.
  const allAgedBlack =
    profiles.length === 4 &&
    profiles.every((profile) => hasContinuousFrame(profile, "agedBlack")) &&
    // A blue sky or green forest can be dark around all four edges. Colorful
    // aged tones additionally need a real frame-to-art boundary on every edge.
    (profiles.every((profile) => hasContinuousFrame(profile, "neutralBlack")) ||
      profiles.every(hasColoredFrameBoundary));
  const allWhite =
    profiles.length === 4 &&
    profiles.every((profile) => hasContinuousFrame(profile, "white"));
  const wornFrame =
    profiles.length === 4 &&
    profiles.every((profile) => {
      const { start, end } = profileRange(profile);
      const band = profile.points.slice(start, end + 1);
      return (
        band.filter((point) => point.black && point.neutralBlack).length /
          band.length >=
        MIN_WORN_FRAME_SUPPORT
      );
    });
  const byEdge = new Map(
    profiles.map((p) => [
      p.edge,
      { profile: p, runs: blackRuns(p, "black", wornFrame) },
    ])
  );
  const connections: Record<
    CardEdge,
    readonly [
      readonly [CardEdge, "start" | "end"],
      readonly [CardEdge, "start" | "end"],
    ]
  > = {
    top: [
      ["left", "start"],
      ["right", "start"],
    ],
    bottom: [
      ["left", "end"],
      ["right", "end"],
    ],
    left: [
      ["top", "start"],
      ["bottom", "start"],
    ],
    right: [
      ["top", "end"],
      ["bottom", "end"],
    ],
  };
  const supported = ([edge, end]: readonly [CardEdge, "start" | "end"]) => {
    const other = byEdge.get(edge);
    if (!other) return false;
    const bounds = profileRange(other.profile);
    return other.runs.some(
      (r) =>
        r.length >= INDEPENDENT_BORDER_RUN_MM &&
        (end === "start" ? r.first === bounds.start : r.last === bounds.end)
    );
  };
  const weights = {} as BleedBorders["weights"];
  for (const profile of profiles) {
    const flags = new Array<boolean>(profile.points.length).fill(false);
    const { step, start, end } = profileRange(profile);
    // A faded footer can be too deep to find an inner edge from the side.
    // Only short, neutral corner runs may borrow adjacent border evidence.
    // Keep these out of byEdge so two ambiguous runs cannot support each other.
    const cornerRuns = blackRuns(profile, "neutralBlack").filter(
      (run) =>
        run.length < INDEPENDENT_BORDER_RUN_MM &&
        (run.first === start || run.last === end)
    );
    for (const run of [...byEdge.get(profile.edge)!.runs, ...cornerRuns]) {
      // Short dark patches inside line art are not borders. Short corner runs
      // are accepted only when supported by a long border on the adjacent side.
      if (
        run.length >= INDEPENDENT_BORDER_RUN_MM ||
        (run.first === start && supported(connections[profile.edge][0])) ||
        (run.last === end && supported(connections[profile.edge][1]))
      ) {
        // Restore only the erosion caused by the confidence window. Unbounded
        // point expansion could jump across fine white strokes between runs.
        let first = run.first,
          last = run.last;
        const reach = Math.ceil(WINDOW_HALF_MM / step);
        while (
          first > Math.max(start, run.first - reach) &&
          profile.points[first - 1].blackAtPoint
        )
          first--;
        while (
          last < Math.min(end, run.last + reach) &&
          profile.points[last + 1].blackAtPoint
        )
          last++;
        flags.fill(true, first, last + 1);
      }
    }
    for (const run of blackRuns(profile, "agedPartialBlack")) {
      if (run.length < INDEPENDENT_BORDER_RUN_MM) continue;
      const depths = profile.points
        .slice(run.first, run.last + 1)
        .map((p) => p.agedBoundaryMm)
        .filter(Number.isFinite);
      // A gently sloping patch may look straight in each 1 mm window. A real
      // border must also hold its depth across the complete accepted run.
      if (!straightBoundary(depths)) continue;
      let first = run.first,
        last = run.last;
      const reach = Math.ceil(WINDOW_HALF_MM / step);
      const matchesBoundary = (i: number) =>
        profile.points[i].agedPartialAtPoint &&
        straightBoundary([...depths, profile.points[i].agedBoundaryMm]);
      while (
        first > Math.max(start, run.first - reach) &&
        matchesBoundary(first - 1)
      )
        first--;
      while (
        last < Math.min(end, run.last + reach) &&
        matchesBoundary(last + 1)
      )
        last++;
      flags.fill(true, first, last + 1);
    }
    // Full-edge continuity is structural evidence for a narrow black border;
    // short shallow dark strokes within line art do not qualify.
    if (profile.points.slice(start, end + 1).every((p) => p.thinBlack))
      flags.fill(true);
    weights[profile.edge] =
      allWhite || allAgedBlack
        ? new Float32Array(flags.length).fill(1)
        : borderWeights(profile, flags);
  }
  return { tone: allWhite ? 255 : 0, weights };
}
