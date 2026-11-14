import { describe, expect, it } from "vitest";
import {
  detectBorderProfile,
  resolveBleedBorders,
  suggestedShadowRemoval,
  type CardEdge,
} from "./bleedBorders";
import type { ArtworkPixels } from "./bleedArtwork";

const GRAIN_SEEDS = [
  1, 42, 777, 12345, 54321, 1235493313, 2749968987, 4294967290,
];
function gaussian(initialSeed: number) {
  let seed = initialSeed;
  const uniform = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed + 1) / 4294967297;
  };
  return () =>
    Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

function profiles(
  color: (x: number, y: number) => number[],
  inset = 0.25,
  scale = 10
) {
  const width = 63 * scale,
    height = 88 * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data.set(
        [...color((x + 0.5) / scale, (y + 0.5) / scale), 255],
        (y * width + x) * 4
      );
  const image: ArtworkPixels = { width, height, data };
  return (["top", "bottom", "left", "right"] as CardEdge[]).map((edge) =>
    detectBorderProfile(
      image,
      { x: 0, y: 0, fullWidth: width, fullHeight: height },
      edge,
      undefined,
      inset
    )
  );
}

describe("local black and full white border detection", () => {
  it.each([3.3, 3.5, 4])(
    "recognizes a faded neutral border %s mm deep",
    (depth) => {
      const result = resolveBleedBorders(
        profiles(
          (x, y) =>
            x < depth && y >= 20 && y < 60 ? [60, 60, 60] : [220, 160, 70],
          0.25,
          20
        )
      );
      expect(result.weights.left.slice(88, 232).every((v) => v === 1)).toBe(
        true
      );
    }
  );
  it.each([3.3, 3.5])(
    "confirms an aged boundary through the full %s mm depth",
    (depth) => {
      const result = resolveBleedBorders(
        profiles(
          (x, y) =>
            x < depth && y >= 20 && y < 60 ? [60, 46, 30] : [220, 160, 70],
          0.25,
          20
        )
      );
      expect(result.weights.left.slice(88, 232).every((v) => v === 1)).toBe(
        true
      );
    }
  );
  it("uses four-sided evidence for worn gray frames without filling the chip", () => {
    const result = resolveBleedBorders(
      profiles(
        (x, y) => {
          if (x < 1.2 && y >= 30 && y < 32) return [200, 200, 200];
          return Math.min(x, y, 63 - x, 88 - y) < 6 + Math.sin(x * 9 + y * 7)
            ? [45, 45, 45]
            : [220, 160, 70];
        },
        0.25,
        20
      )
    );
    for (const edge of ["top", "right", "bottom"] as const)
      expect(result.weights[edge].every((v) => v === 1)).toBe(true);
    expect(result.weights.left.slice(12, 112).every((v) => v === 1)).toBe(true);
    expect(result.weights.left.slice(140, 340).every((v) => v === 1)).toBe(
      true
    );
    expect(result.weights.left[31 / 0.25]).toBeLessThan(1);
  });
  it("does not infer a worn frame from four dark navy edges alone", () => {
    const result = resolveBleedBorders(profiles(() => [20, 25, 44]));
    expect(
      Object.values(result.weights).every((w) => w.every((v) => v === 0))
    ).toBe(true);
  });
  it.each([
    { tone: 240, depth: 0.5, expected: 0.6 },
    { tone: 30, depth: 0.4, expected: 0.5 },
  ])(
    "suggests a deeper margin for a corroborated frame shadow: %j",
    ({ tone, depth, expected }) => {
      const source = (x: number, y: number) =>
        x < depth
          ? [140, 140, 140]
          : Math.min(x, y, 63 - x, 88 - y) < 2
            ? [tone, tone, tone]
            : [220, 120, 30];
      expect(suggestedShadowRemoval(profiles(source, 0.25, 20))).toBe(expected);
      expect(
        suggestedShadowRemoval(profiles(source, expected, 20))
      ).toBeUndefined();
    }
  );
  it("does not suggest shadow removal for uncorroborated colored artwork", () => {
    expect(
      suggestedShadowRemoval(profiles((x, y) => [40 + x, 80 + y, 140]))
    ).toBeUndefined();
  });
  it.each([30, 240])(
    "suggests a margin for shadows on two adjacent frame edges (%s)",
    (tone) => {
      const noise = gaussian(54321);
      const source = (x: number, y: number) => {
        const value =
          x < 0.5 || y < 0.5
            ? 140
            : Math.min(x, y, 63 - x, 88 - y) < 2
              ? tone
              : undefined;
        return value === undefined
          ? [220, 120, 30]
          : [value + 2 * noise(), value + 2 * noise(), value + 2 * noise()];
      };
      expect(suggestedShadowRemoval(profiles(source, 0.25, 20))).toBe(0.6);
      const corrected = resolveBleedBorders(profiles(source, 0.6, 20));
      expect(corrected.tone).toBe(tone === 240 ? 255 : 0);
      expect(
        Object.values(corrected.weights).every((w) => w.every((v) => v === 1))
      ).toBe(true);
    }
  );
  it("does not suggest a two-edge repair when one suspect is uncorroborated artwork", () => {
    expect(
      suggestedShadowRemoval(
        profiles((x, y) =>
          x < 0.5
            ? [140, 140, 140]
            : y < 2
              ? [30, 100, 180]
              : Math.min(x, 63 - x, 88 - y) < 2
                ? [240, 240, 240]
                : [220, 120, 30]
        )
      )
    ).toBeUndefined();
  });
  it.each([
    { color: [60, 60, 60], side: "left" },
    { color: [80, 80, 80], side: "left" },
    { color: [20, 25, 44], side: "top" },
    { color: [35, 42, 50], side: "top" },
  ])(
    "preserves deep dark artwork without a frame boundary: %j",
    ({ color, side }) => {
      const result = resolveBleedBorders(
        profiles(
          (x, y) => {
            const art = side === "left" ? x < 20 && y >= 20 && y < 60 : y < 20;
            const texture = side === "left" ? 8 * Math.sin(x * 7 + y * 13) : 0;
            return art ? color.map((c) => c + texture) : [220, 160, 70];
          },
          0.25,
          12
        )
      );
      expect(
        Object.values(result.weights).every((w) => w.every((v) => v === 0))
      ).toBe(true);
    }
  );
  it.each([
    [40, 48, 72],
    [30, 60, 40],
    [70, 60, 90],
  ])(
    "keeps colored art bands with straight boundaries as artwork (%s)",
    (r, g, b) => {
      const result = resolveBleedBorders(
        profiles((x, y) => (y < 2.5 || x < 2.5 ? [r, g, b] : [210, 150, 70]))
      );
      expect(
        Object.values(result.weights).every((w) => w.every((v) => v === 0))
      ).toBe(true);
    }
  );

  it.each([
    { color: [95, 70, 60], sd: 3 },
    { color: [95, 70, 60], sd: 4 },
    { color: [95, 70, 60], sd: 6 },
    { color: [88, 68, 60], sd: 4 },
    { color: [88, 68, 60], sd: 6 },
    { color: [100, 98, 96], sd: 4 },
    { color: [100, 98, 96], sd: 6 },
    { color: [45, 43, 42], sd: 4 },
    { color: [45, 43, 42], sd: 6 },
  ])(
    "recognizes partial borders with independent RGB scan grain: %j",
    ({ color, sd }) => {
      for (const initialSeed of GRAIN_SEEDS) {
        const normal = gaussian(initialSeed);
        const result = resolveBleedBorders(
          profiles(
            (x, y) =>
              x < 3 && y >= 20 && y < 60
                ? color.map((c) => c + sd * normal())
                : [220, 160, 70],
            0.25,
            12
          )
        );
        expect(
          result.weights.left.slice(22 / 0.25, 58 / 0.25).every((v) => v === 1),
          `seed ${initialSeed}`
        ).toBe(true);
        for (const edge of ["top", "right", "bottom"] as const)
          expect(result.weights[edge].every((v) => v === 0)).toBe(true);
      }
    }
  );

  it.each([
    [95, 70, 60],
    [100, 98, 96],
  ])("recognizes full aged frames with six-level RGB grain (%s)", (r, g, b) => {
    for (const seed of GRAIN_SEEDS) {
      const noise = gaussian(seed);
      const result = resolveBleedBorders(
        profiles(
          (x, y) =>
            Math.min(x, y, 63 - x, 88 - y) < 3
              ? [r, g, b].map((c) => c + 6 * noise())
              : [220, 160, 70],
          0.25,
          12
        )
      );
      expect(
        Object.values(result.weights).every((w) => w.every((v) => v === 1)),
        `seed ${seed}`
      ).toBe(true);
    }
  });
  it.each([
    [35, 40, 48],
    [50, 55, 60],
    [55, 50, 45],
  ])(
    "keeps near-neutral full-edge treatment consistent under grain (%s)",
    (r, g, b) => {
      for (const seed of GRAIN_SEEDS) {
        const noise = gaussian(seed);
        const result = resolveBleedBorders(
          profiles(() => [r, g, b].map((c) => c + 3 * noise()), 0.25, 12)
        );
        expect(
          Object.values(result.weights).every((w) => w.every((v) => v === 1)),
          `seed ${seed}`
        ).toBe(true);
      }
    }
  );

  it.each([
    { color: [30, 40, 70], texture: 0 },
    { color: [30, 40, 70], texture: 20 },
    { color: [30, 40, 70], texture: 40 },
    { color: [30, 60, 40], texture: 0 },
    { color: [30, 60, 40], texture: 20 },
    { color: [70, 60, 90], texture: 0 },
    { color: [70, 60, 90], texture: 20 },
  ])("preserves dark colored borderless artwork: %j", ({ color, texture }) => {
    const result = resolveBleedBorders(
      profiles(
        (x, y) => {
          const delta = texture * Math.sin(x * 7 + y * 13);
          return color.map((c) => Math.max(0, Math.min(255, c + delta)));
        },
        0.25,
        12
      )
    );
    expect(
      Object.values(result.weights).every((w) => w.every((v) => v === 0))
    ).toBe(true);
  });

  it.each([
    [42, 40, 38],
    [107, 104, 101],
    [60, 46, 30],
  ])("recognizes worn or warm-cast black %s", (r, g, b) => {
    const result = resolveBleedBorders(
      profiles(
        (x, y) => {
          if (x >= 0.3 && x < 0.6 && y % 6 < 0.25) return [216, 212, 204];
          return Math.min(x, y, 63 - x, 88 - y) < 3 ? [r, g, b] : [40, 160, 80];
        },
        0.25,
        20
      )
    );
    expect(result.tone).toBe(0);
    expect(
      Object.values(result.weights).every((w) => w.every((v) => v === 1))
    ).toBe(true);
  });
  it.each([
    [107, 104, 101],
    [60, 46, 30],
  ])("accepts one full-depth wear scratch in a faded frame %s", (r, g, b) => {
    const result = resolveBleedBorders(
      profiles(
        (x, y) => {
          if (x < 1 && y >= 30 && y < 30.1) return [216, 212, 204];
          return Math.min(x, y, 63 - x, 88 - y) < 3
            ? [r, g, b]
            : [238, 187, 51];
        },
        0.25,
        20
      )
    );
    expect(
      Object.values(result.weights).every((w) => w.every((v) => v === 1))
    ).toBe(true);
  });

  it.each([
    { color: [60, 46, 30], depth: 0.6, length: 0.4 },
    { color: [107, 104, 101], depth: 0.6, length: 0.4 },
    { color: [60, 46, 30], depth: 0.45, length: 1 },
    { color: [107, 104, 101], depth: 0.45, length: 1 },
  ])(
    "keeps an aged frame black around one edge chip: %j",
    ({ color, depth, length }) => {
      const result = resolveBleedBorders(
        profiles(
          (x, y) => {
            if (x < depth && y >= 40 && y < 40 + length) return [215, 215, 215];
            return Math.min(x, y, 63 - x, 88 - y) < 3 ? color : [238, 187, 51];
          },
          0.25,
          20
        )
      );
      expect(
        Object.values(result.weights).every((w) => w.every((v) => v === 1))
      ).toBe(true);
    }
  );

  it.each([0, 0.25, 0.5, 1])(
    "extends warm 3 mm side borders beside dark artwork (%s mm inset)",
    (inset) => {
      const result = resolveBleedBorders(
        profiles(
          (x, y) =>
            x < 3 || x > 60
              ? [60, 46, 30]
              : [
                  150 + 60 * Math.sin((x * 12) / 9),
                  90 + 50 * Math.cos((y * 12) / 7),
                  60,
                ],
          inset,
          20
        )
      );
      expect(result.weights.left.every((v) => v === 1)).toBe(true);
      expect(result.weights.right.every((v) => v === 1)).toBe(true);
      expect(result.weights.top.every((v) => v === 0)).toBe(true);
      expect(result.weights.bottom.every((v) => v === 0)).toBe(true);
    }
  );

  it.each([0, 0.25, 0.5, 1])(
    "extends a faded 3 mm bottom border on its own (%s mm inset)",
    (inset) => {
      const result = resolveBleedBorders(
        profiles(
          (x, y) =>
            y > 85
              ? [107, 104, 101]
              : [150 + 60 * Math.sin(x), 90 + 50 * Math.cos(y), 60],
          inset,
          20
        )
      );
      expect(result.weights.bottom.every((v) => v === 1)).toBe(true);
      for (const edge of ["top", "left", "right"] as const)
        expect(result.weights[edge].every((v) => v === 0)).toBe(true);
    }
  );

  it("recognizes an aged partial run and leaves its neighboring artwork alone", () => {
    const result = resolveBleedBorders(
      profiles((x, y) =>
        x < 3 && y >= 20 && y < 40 ? [107, 104, 101] : [238, 187, 51]
      )
    );
    expect(
      result.weights.left.slice(20 / 0.25, 40 / 0.25).every((v) => v === 1)
    ).toBe(true);
    expect(result.weights.left[18 / 0.25]).toBe(0);
    expect(result.weights.left[42 / 0.25]).toBe(0);
    for (const edge of ["top", "bottom", "right"] as const)
      expect(result.weights[edge].every((v) => v === 0)).toBe(true);
  });

  it.each(["short", "deep", "sloping", "fine strokes", "inner ink"])(
    "does not promote aged %s artwork into a partial border",
    (kind) => {
      const result = resolveBleedBorders(
        profiles(
          (x, y) => {
            const depth =
              kind === "deep" ? 4 : kind === "sloping" ? 2 + y * 0.008 : 3;
            const inRun = kind !== "short" || (y >= 30 && y < 35);
            if (x < depth && inRun) {
              if (kind === "fine strokes" && y % 2 < 0.15)
                return [240, 240, 240];
              if (kind === "inner ink" && x >= 1 && x < 1.1)
                return [240, 240, 240];
              return [107, 104, 101];
            }
            return [238, 187, 51];
          },
          0.25,
          20
        )
      );
      expect(
        Object.values(result.weights).every((w) => w.every((v) => v === 0))
      ).toBe(true);
    }
  );

  it.each(["long", "repeated"])(
    "rejects %s full-depth artwork breaks in a faded frame",
    (kind) => {
      const result = resolveBleedBorders(
        profiles(
          (x, y) => {
            const stroke = kind === "long" ? y >= 30 && y < 32 : y % 6 < 0.1;
            if (x < 1 && stroke) return [216, 212, 204];
            return Math.min(x, y, 63 - x, 88 - y) < 3
              ? [107, 104, 101]
              : [238, 187, 51];
          },
          0.25,
          20
        )
      );
      // The interruption cannot promote the whole frame. Uninterrupted edges
      // can now qualify separately through their straight 3 mm inner boundary.
      expect(result.weights.left[31 / 0.25]).toBeLessThan(0.5);
      if (kind === "repeated")
        expect(result.weights.left.every((v) => v === 0)).toBe(true);
    }
  );

  it.each([0, 0.25, 0.5])(
    "extends aged neutral black without sampling the shadow margin (%s mm)",
    (inset) => {
      const result = resolveBleedBorders(
        profiles((x, y) => {
          const d = Math.min(x, y, 63 - x, 88 - y);
          if (d < inset) return [255, 0, 255];
          return d < 1.5 ? [70, 73, 75] : [180, 50, 20];
        }, inset)
      );
      expect(result.tone).toBe(0);
      expect(
        Object.values(result.weights).every((w) => w.every((v) => v === 1))
      ).toBe(true);
    }
  );

  it("accepts an aged cream full border with a small scratch", () => {
    const result = resolveBleedBorders(
      profiles((x, y) => {
        if (y < 1 && x > 30 && x < 30.2) return [100, 100, 100];
        return Math.min(x, y, 63 - x, 88 - y) < 2
          ? [232, 216, 195]
          : [180, 50, 20];
      })
    );
    expect(result.tone).toBe(255);
    expect(
      Object.values(result.weights).every((w) => w.every((v) => v === 1))
    ).toBe(true);
  });

  it("does not whiten partial white artwork or a border interrupted by art", () => {
    const result = resolveBleedBorders(
      profiles((x, y) => {
        if (y < 1 && x > 25 && x < 40) return [30, 90, 140];
        return [240, 240, 240];
      })
    );
    expect(result.tone).toBe(0);
    expect(
      Object.values(result.weights).every((w) => w.every((v) => v === 0))
    ).toBe(true);
  });

  it("preserves isolated dark art and fine white ink, while joining short corner borders", () => {
    const result = resolveBleedBorders(
      profiles((x, y) => {
        if (y < 1.2 || (x < 1.2 && y < 7)) return [20, 20, 20];
        // A short black artwork pocket midway down the edge is not a border.
        if (x < 1.2 && y > 30 && y < 35) return [20, 20, 20];
        // Closely spaced fine white strokes prohibit treating monochrome art as black.
        if (x > 61.8) return y % 0.5 < 0.1 ? [240, 240, 240] : [20, 20, 20];
        return [50, 140, 180];
      })
    );
    expect(result.weights.top.every((v) => v === 1)).toBe(true);
    expect(result.weights.left[0]).toBe(1);
    expect(result.weights.left[Math.round(6.75 / 0.25)]).toBe(1);
    expect(result.weights.left[Math.round(32 / 0.25)]).toBe(0);
    expect(result.weights.right.every((v) => v === 0)).toBe(true);
  });

  it("continues a faded footer onto its short side runs using independent bottom evidence", () => {
    const result = resolveBleedBorders(
      profiles((x, y) => {
        if (y < 81) return [50, 140, 180];
        // Legal text supplies a bounded inner edge across most of the footer,
        // but the footer extends deeper than 4.5 mm from either side edge.
        if (x > 6 && x < 57 && y > 85 && y < 85.4) return [230, 230, 230];
        return [60, 60, 60];
      })
    );
    expect(result.weights.bottom.every((v) => v === 1)).toBe(true);
    for (const edge of ["left", "right"] as const) {
      expect(result.weights[edge].slice(82 / 0.25).every((v) => v === 1)).toBe(
        true
      );
      expect(result.weights[edge][78 / 0.25]).toBe(0);
    }
  });

  it("does not let two ambiguous corner runs corroborate each other", () => {
    const result = resolveBleedBorders(
      profiles((x, y) =>
        x > 57 && y > 82 ? [60, 60, 60] : [50, 140, 180]
      )
    );
    expect(
      Object.values(result.weights).every((w) => w.every((v) => v === 0))
    ).toBe(true);
  });

  it("does not extend a confident footer into long deep gray artwork beside it", () => {
    const result = resolveBleedBorders(
      profiles((x, y) =>
        y > 86 || (x > 43 && y > 68) ? [60, 60, 60] : [50, 140, 180]
      )
    );
    expect(result.weights.bottom.every((v) => v === 1)).toBe(true);
    expect(result.weights.right.every((v) => v === 0)).toBe(true);
  });

  it.each([0, 0.25, 0.5])(
    "recognizes a thin black border beside bright artwork (%s mm inset)",
    (inset) => {
      const result = resolveBleedBorders(
        profiles((x) => (x < 0.8 ? [18, 18, 18] : [240, 207, 115]), inset)
      );
      expect(result.weights.left.every((v) => v === 1)).toBe(true);
      expect(result.weights.top.every((v) => v === 0)).toBe(true);
      expect(result.weights.right.every((v) => v === 0)).toBe(true);
    }
  );

  it.each([0, 0.25, 0.5])(
    "recognizes a straight partial thin border (%s mm inset)",
    (inset) => {
      const result = resolveBleedBorders(
        profiles(
          (x, y) =>
            x < 0.8 && y >= 20 && y < 40 ? [18, 18, 18] : [240, 207, 115],
          inset
        )
      );
      expect(
        result.weights.left.slice(21 / 0.25, 39 / 0.25).every((v) => v === 1)
      ).toBe(true);
      expect(result.weights.left[10 / 0.25]).toBe(0);
      expect(result.weights.left[50 / 0.25]).toBe(0);
      expect(result.weights.top.every((v) => v === 0)).toBe(true);
    }
  );

  it("keeps the physical classification stable across source resolutions", () => {
    const color = (x: number, y: number) =>
      y < 1.5 || (x < 1.5 && y > 60) ? [24, 26, 29] : [40, 140, 200];
    const low = resolveBleedBorders(profiles(color, 0.25, 10));
    const high = resolveBleedBorders(profiles(color, 0.25, 20));
    expect(low).toEqual(high);
  });
});
