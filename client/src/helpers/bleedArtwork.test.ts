import { describe, expect, it } from "vitest";
import {
  CARD_CORNER_RADIUS_MM,
  MAX_SCAN_INSET_MM,
  repairScanPerimeter,
  repairScanPerimeterAsync,
  type ArtworkPixels,
} from "./bleedArtwork";

// Independent circle/straight-edge oracle in physical coordinates.
function trusted(x: number, y: number, inset: number) {
  const u = Math.min(x, 63 - x),
    v = Math.min(y, 88 - y);
  if (u < inset || v < inset) return false;
  if (u >= 2.5 || v >= 2.5) return true;
  return v >= 2.5 - Math.sqrt((2.5 - inset) ** 2 - (2.5 - u) ** 2);
}

function fixture(
  width: number,
  height: number,
  inset: number,
  contamination: readonly number[],
  color: (x: number, y: number) => readonly number[] = (x, y) => [
    60 + x * 2,
    70 + y,
    100 + (x + y) / 2,
  ]
): ArtworkPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const px = ((x + 0.5) * 63) / width,
        py = ((y + 0.5) * 88) / height;
      data.set(
        trusted(px, py, inset) ? [...color(px, py), 255] : contamination,
        (y * width + x) * 4
      );
    }
  return { width, height, data };
}

// Build a source silhouette from horizontal circle intersections. This models
// the scanner's cutout independently of the renderer's nearest-center mask.
function roundedSource(
  width: number,
  height: number,
  radius: number,
  background: readonly number[],
  artwork: readonly number[] = [32, 90, 160, 255]
): ArtworkPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = ((Math.min(y, height - y - 1) + 0.5) * 88) / height;
    const edge =
      v < radius ? radius - Math.sqrt(radius * radius - (radius - v) ** 2) : 0;
    for (let x = 0; x < width; x++) {
      const u = ((Math.min(x, width - x - 1) + 0.5) * 63) / width;
      data.set(u < edge ? background : artwork, (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

describe("scan perimeter reconstruction", () => {
  for (const [width, height] of [
    [126, 176],
    [630, 880],
    [1260, 1760],
  ]) {
    for (const inset of [0, 0.25, 0.5, 0.8, 1]) {
      it(`excludes every unsafe donor and preserves the safe core at ${width} × ${height}, inset ${inset}`, () => {
        const transparent = fixture(width, height, inset, [255, 0, 255, 0]);
        const opaque = fixture(width, height, inset, [255, 0, 255, 255]);
        const fringe = fixture(width, height, inset, [0, 255, 0, 128]);
        const original = opaque.data.slice();
        repairScanPerimeter(transparent, inset);
        repairScanPerimeter(opaque, inset);
        repairScanPerimeter(fringe, inset);
        // Nuisance colors/alpha outside the safe mask have no influence.
        expect(opaque.data.every((v, i) => v === transparent.data[i])).toBe(
          true
        );
        expect(opaque.data.every((v, i) => v === fringe.data[i])).toBe(true);
        let changedCore = 0,
          nonOpaque = 0,
          leaked = 0;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const core = trusted(
              ((x + 0.5) * 63) / width,
              ((y + 0.5) * 88) / height,
              inset
            );
            for (let channel = 0; channel < 4; channel++)
              if (core && opaque.data[i + channel] !== original[i + channel])
                changedCore++;
            if (opaque.data[i + 3] !== 255) nonOpaque++;
            if (opaque.data[i] === 255 && opaque.data[i + 2] === 255) leaked++;
          }
        expect({ changedCore, nonOpaque, leaked }).toEqual({
          changedCore: 0,
          nonOpaque: 0,
          leaked: 0,
        });
      });
    }
  }

  it("matches each local border, including legitimate black and white artwork", () => {
    const colors = [
      [0, 0, 0],
      [255, 255, 255],
      [203, 169, 50],
      [45, 100, 181],
    ];
    const image = fixture(
      630,
      880,
      0.25,
      [255, 0, 255, 255],
      (x, y) => colors[(x < 31.5 ? 0 : 1) + (y < 44 ? 0 : 2)]
    );
    repairScanPerimeter(image);
    for (const [x, y, index] of [
      [0, 0, 0],
      [629, 0, 1],
      [0, 879, 2],
      [629, 879, 3],
    ])
      expect(
        Array.from(image.data.slice((y * 630 + x) * 4, (y * 630 + x) * 4 + 4))
      ).toEqual([...colors[index], 255]);
  });

  it("keeps a smooth gradient continuous across the repaired arc and tangent joins", () => {
    const image = fixture(630, 880, 0.25, [255, 0, 255, 255]);
    repairScanPerimeter(image);
    let maxJump = 0;
    for (let y = 0; y < 55; y++)
      for (let x = 0; x < 55; x++) {
        const i = (y * 630 + x) * 4;
        for (const j of [i + 4, i + 630 * 4])
          for (let c = 0; c < 3; c++)
            maxJump = Math.max(
              maxJump,
              Math.abs(image.data[i + c] - image.data[j + c])
            );
      }
    expect(maxJump).toBeLessThanOrEqual(2);
  });

  it.each([
    [0.5, 2.5],
    [1, 2.5],
    [1, 3.2],
    [1, 3.5],
  ])(
    "is deterministic and rotation symmetric at inset %s / radius %s",
    (inset, radius) => {
      const image = fixture(630, 880, inset, [255, 0, 255, 255], (x, y) => [
        50 + x * 2,
        70 + y,
        100 + 40 * Math.sin((x + y) * 2),
      ]);
      const rotate = (data: Uint8ClampedArray) => {
        const result = new Uint8ClampedArray(data.length);
        for (let i = 0; i < data.length; i += 4)
          result.set(data.subarray(i, i + 4), data.length - i - 4);
        return result;
      };
      const copy = { ...image, data: image.data.slice() };
      const rotated = { ...image, data: rotate(image.data) };
      repairScanPerimeter(image, inset, undefined, radius);
      repairScanPerimeter(copy, inset, undefined, radius);
      repairScanPerimeter(rotated, inset, undefined, radius);
      expect(image.data.every((v, i) => v === copy.data[i])).toBe(true);
      let difference = 0;
      const inverse = rotate(rotated.data);
      for (let i = 0; i < inverse.length; i++)
        difference = Math.max(difference, Math.abs(inverse[i] - image.data[i]));
      expect(difference).toBeLessThanOrEqual(1);
    }
  );

  it.each([2.5, 3.2, 3.5])(
    "keeps corner tangents continuous at 1 mm inset / %s mm radius",
    (radius) => {
      const image = fixture(1260, 1760, 1, [255, 0, 255, 255]);
      repairScanPerimeter(image, 1, undefined, radius);
      let maxJump = 0;
      for (let y = 0; y < 100; y++)
        for (let x = 0; x < 100; x++) {
          const p = (y * image.width + x) * 4;
          for (const next of [p + 4, p + image.width * 4])
            for (let channel = 0; channel < 3; channel++)
              maxJump = Math.max(
                maxJump,
                Math.abs(image.data[p + channel] - image.data[next + channel])
              );
        }
      expect(maxJump).toBeLessThanOrEqual(2);
    }
  );

  it("never samples hidden RGB from transparent sources", () => {
    const image = {
      width: 126,
      height: 176,
      data: new Uint8ClampedArray(126 * 176 * 4),
    };
    repairScanPerimeter(image);
    expect(Array.from(image.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });

  it.each([
    [255, 255, 255, 255],
    [0, 0, 0, 255],
    [238, 238, 238, 255],
    [255, 0, 255, 0],
    [0, 255, 0, 128],
  ])(
    "excludes a selected 3.175 mm source cutout with background %j",
    (...bed) => {
      for (const inset of [0, 0.25, 1]) {
        const image = roundedSource(744, 1040, 3.175, bed);
        repairScanPerimeter(image, inset, undefined, 3.2);
        expect(
          image.data.every((v, i) => v === [32, 90, 160, 255][i % 4])
        ).toBe(true);
      }
      expect(CARD_CORNER_RADIUS_MM).toBe(2.5);
    }
  );

  it.each([
    [255, 255, 255, 255],
    [0, 0, 0, 255],
    [202, 147, 59, 255],
  ])(
    "does not infer background from legitimate uniform corner art %j",
    (...ink) => {
      // This raster can represent either a scanner bed or intentional flat ink.
      // Without a wider source-radius choice, its trusted artwork must survive.
      const image = roundedSource(1260, 1760, 3.175, ink);
      const original = image.data.slice();
      const explicitDefault = { ...image, data: image.data.slice() };
      repairScanPerimeter(image);
      repairScanPerimeter(explicitDefault, 0.25, undefined, 2.5);
      expect(image.data.every((v, i) => v === explicitDefault.data[i])).toBe(
        true
      );
      let protectedInk = 0,
        changed = 0;
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          if (
            !trusted(
              ((x + 0.5) * 63) / image.width,
              ((y + 0.5) * 88) / image.height,
              0.25
            )
          )
            continue;
          const p = (y * image.width + x) * 4;
          if (ink.every((v, channel) => original[p + channel] === v))
            protectedInk++;
          for (let channel = 0; channel < 4; channel++)
            if (image.data[p + channel] !== original[p + channel]) changed++;
        }
      expect(protectedInk).toBeGreaterThan(0);
      expect(changed).toBe(0);
    }
  );

  it("removes a selected 0.8 mm opaque shadow and reflects straight edges normally", () => {
    expect(MAX_SCAN_INSET_MM).toBe(1);
    const image = fixture(630, 880, 0.8, [120, 120, 120, 255], (x) => [
      30 + 2 * x,
      90,
      160,
    ]);
    const original = image.data.slice();
    repairScanPerimeter(image, 1);
    let leaked = 0;
    for (let p = 0; p < image.data.length; p += 4)
      if (
        image.data[p + 1] !== 90 ||
        image.data[p + 2] !== 160 ||
        image.data[p + 3] !== 255
      )
        leaked++;
    expect(leaked).toBe(0);
    // At 10 px/mm, the first pixel center at 0.05 mm reflects through x=1 mm
    // to the original center at 1.95 mm, without the corner's nonlinear limit.
    const row = 440 * image.width;
    expect(image.data[row * 4]).toBe(original[(row + 19) * 4]);
  });

  it("clamps source radius and shares the selected geometry with async repair", async () => {
    const input = roundedSource(630, 880, 3.175, [255, 255, 255, 255]);
    const sync = { ...input, data: input.data.slice() };
    const asyncImage = { ...input, data: input.data.slice() };
    repairScanPerimeter(sync, 1, undefined, 3.2);
    await repairScanPerimeterAsync(
      asyncImage,
      1,
      { x: 0, y: 0, fullWidth: input.width, fullHeight: input.height },
      undefined,
      3.2
    );
    expect(asyncImage.data.every((v, i) => v === sync.data[i])).toBe(true);
    for (const [value, expected] of [
      [0, 2.5],
      [99, 3.5],
      [NaN, 2.5],
    ]) {
      const actual = { ...input, data: input.data.slice() };
      const reference = { ...input, data: input.data.slice() };
      repairScanPerimeter(actual, 1, undefined, value);
      repairScanPerimeter(reference, 1, undefined, expected);
      expect(actual.data.every((v, i) => v === reference.data[i])).toBe(true);
    }
  });

  it("repairs partial-alpha arcs and transparent edge slop even at zero inset", () => {
    for (const inset of [0, 0.25]) {
      const width = 744,
        height = 1040;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const u = (Math.min(x + 0.5, width - x - 0.5) * 63) / width,
            v = (Math.min(y + 0.5, height - y - 0.5) * 88) / height;
          const fringe =
            u < 0.34 ||
            v < 0.34 ||
            (u < 3.2 && v < 3.2 && (u - 3.2) ** 2 + (v - 3.2) ** 2 > 3.2 ** 2);
          data.set(
            fringe ? [255, 0, 255, (x + y) % 255] : [32, 90, 160, 255],
            (y * width + x) * 4
          );
        }
      repairScanPerimeter({ width, height, data }, inset);
      expect(data.every((v, i) => v === [32, 90, 160, 255][i % 4])).toBe(true);
    }
  });

  it("perimeter-band repair equals a full-raster repair, including odd dimensions", () => {
    for (const [width, height] of [
      [126, 177],
      [744, 1040],
    ]) {
      const original = fixture(width, height, 0.5, [255, 0, 255, 128]);
      const whole = { ...original, data: original.data.slice() };
      repairScanPerimeter(whole, 0.5);
      const bandX = Math.ceil((2.5 * width) / 63) + 2;
      const bandY = Math.ceil((2.5 * height) / 88) + 2;
      for (const [x, y, w, h] of [
        [0, 0, width, bandY],
        [0, height - bandY, width, bandY],
        [0, bandY, bandX, height - 2 * bandY],
        [width - bandX, bandY, bandX, height - 2 * bandY],
      ]) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row++)
          data.set(
            original.data.subarray(
              ((y + row) * width + x) * 4,
              ((y + row) * width + x + w) * 4
            ),
            row * w * 4
          );
        repairScanPerimeter({ width: w, height: h, data }, 0.5, {
          x,
          y,
          fullWidth: width,
          fullHeight: height,
        });
        for (let row = 0; row < h; row++)
          original.data.set(
            data.subarray(row * w * 4, (row + 1) * w * 4),
            ((y + row) * width + x) * 4
          );
      }
      expect(original.data.every((v, i) => v === whole.data[i])).toBe(true);
    }
  });

  it.each([3.2, 3.5])(
    "repairs wider source corners identically through overlapping perimeter bands (%s mm)",
    (radius) => {
      const width = 745,
        height = 1041;
      const original = roundedSource(width, height, 3.175, [255, 255, 255, 255]);
      const whole = { ...original, data: original.data.slice() };
      const combined = original.data.slice();
      repairScanPerimeter(whole, 1, undefined, radius);
      const bandX = Math.ceil((4.5 * width) / 63) + 2,
        bandY = Math.ceil((4.5 * height) / 88) + 2;
      for (const [x, y, w, h] of [
        [0, 0, width, bandY],
        [0, height - bandY, width, bandY],
        [0, 0, bandX, height],
        [width - bandX, 0, bandX, height],
      ]) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row++)
          data.set(
            original.data.subarray(
              ((y + row) * width + x) * 4,
              ((y + row) * width + x + w) * 4
            ),
            row * w * 4
          );
        repairScanPerimeter(
          { width: w, height: h, data },
          1,
          { x, y, fullWidth: width, fullHeight: height },
          radius
        );
        for (let row = 0; row < h; row++)
          combined.set(
            data.subarray(row * w * 4, (row + 1) * w * 4),
            ((y + row) * width + x) * 4
          );
      }
      expect(combined.every((v, i) => v === whole.data[i])).toBe(true);
    }
  );
});
