import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const requireClient = createRequire(
  new URL("../client/package.json", import.meta.url)
);
let renderer: string;

test.beforeAll(async () => {
  // Use the project's own bundler to exercise the real canvas adapter without
  // exposing test-only globals or entry points in the shipped application.
  const { build } = requireClient("vite");
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      lib: {
        entry: fileURLToPath(
          new URL("../client/src/helpers/canvasProcessing.ts", import.meta.url)
        ),
        name: "CardRenderer",
        formats: ["iife"],
      },
    },
  });
  renderer = (Array.isArray(result) ? result : [result])
    .flatMap((output: any) => output.output)
    .find((item: any) => item.type === "chunk").code;
});
test.beforeEach(async ({ page }) => {
  await page.addScriptTag({ content: renderer });
});

test("aged and partial black borders stay black while detailed monochrome art continues", async ({
  page,
}) => {
  const cases = await Promise.all(
    ["fireball", "hit-it", "elas-il-kor", "white-border-lightning-bolt"].map(
      async (name) => ({
        name,
        src:
          "data:image/png;base64," +
          (
            await readFile(new URL(`./fixtures/${name}.png`, import.meta.url))
          ).toString("base64"),
      })
    )
  );
  const results = await page.evaluate(async (cases) => {
    const results = [];
    for (const { name, src } of cases) {
      for (const [dpi, insetMm] of [
        [200, 0],
        [254, 0.25],
        [1200, 0.5],
      ]) {
        const output = await (window as any).CardRenderer.renderCardCanvas(
          src,
          5,
          false,
          dpi,
          { artwork: { source: "scan", insetMm } }
        );
        const data = output
          .getContext("2d")
          .getImageData(0, 0, output.width, output.height).data;
        const ppm = dpi / 25.4,
          b = Math.round(5 * ppm),
          w = Math.round(63 * ppm),
          h = Math.round(88 * ppm);
        let nonBlack = 0,
          nonWhite = 0,
          artBright = 0,
          artCount = 0,
          checked = 0;
        for (let y = 0; y < output.height; y++)
          for (let x = 0; x < output.width; x++) {
            const dx = Math.max(b - 1 - x, x - (b + w), 0),
              dy = Math.max(b - 1 - y, y - (b + h), 0);
            if (Math.max(dx, dy) <= Math.ceil(0.2 * ppm)) continue;
            const top = y < b && x >= b && x < b + w,
              bottom = y >= b + h && x >= b && x < b + w;
            const side =
              (x < b || x >= b + w) &&
              ((y >= b + 4 * ppm && y < b + (x < b ? 8 : 9) * ppm) ||
                (y >= b + 58 * ppm && y < b + 83 * ppm));
            const shouldBlack =
              name === "fireball" ||
              (name === "hit-it" && (top || bottom || side)) ||
              (name === "elas-il-kor" && bottom);
            const p = (y * output.width + x) * 4,
              max = Math.max(data[p], data[p + 1], data[p + 2]);
            if (shouldBlack) {
              checked++;
              if (max > 0) nonBlack++;
            }
            if (name === "white-border-lightning-bolt") {
              checked++;
              if (data[p] !== 255 || data[p + 1] !== 255 || data[p + 2] !== 255)
                nonWhite++;
            }
            if (name === "elas-il-kor" && top) {
              artCount++;
              if (max > 64) artBright++;
            }
          }
        let changedArt = 0,
          firstChangedMm = Infinity,
          lastChangedMm = 0;
        if (name === "elas-il-kor" || name === "hit-it") {
          const reference = await (window as any).CardRenderer.renderCardCanvas(
            src,
            5,
            false,
            dpi,
            { artwork: { source: "scan", insetMm, borders: "mirror" } }
          );
          const raw = reference
            .getContext("2d")
            .getImageData(0, 0, reference.width, reference.height).data;
          for (let y = 0; y < output.height; y++)
            for (let x = 0; x < output.width; x++) {
              const artEdge =
                name === "elas-il-kor"
                  ? (y < b && x >= b && x < b + w) ||
                    ((x < b || x >= b + w) && y >= b && y < b + 80 * ppm)
                  : (x < b || x >= b + w) &&
                    // The short taper beyond the upper black border ends
                    // before 11 mm; the remaining artwork must be untouched.
                    y > b + 11 * ppm &&
                    y < b + 48 * ppm;
              if (artEdge)
                for (let c = 0; c < 4; c++) {
                  const p = (y * output.width + x) * 4 + c;
                  if (data[p] !== raw[p]) {
                    changedArt++;
                    firstChangedMm = Math.min(firstChangedMm, (y - b) / ppm);
                    lastChangedMm = Math.max(lastChangedMm, (y - b) / ppm);
                  }
                }
            }
          reference.width = reference.height = 0;
        }
        results.push({
          name,
          dpi,
          insetMm,
          nonBlack,
          nonWhite,
          changedArt,
          firstChangedMm,
          lastChangedMm,
          checked,
          artFraction: artCount ? artBright / artCount : 0,
          png: dpi === 254 ? output.toDataURL() : null,
        });
        output.width = output.height = 0;
      }
    }
    return results;
  }, cases);
  await mkdir(".artifacts/bleed", { recursive: true });
  await writeFile(
    `.artifacts/bleed/border-metrics-${test.info().project.name}.json`,
    JSON.stringify(
      results.map(({ png, ...metrics }) => metrics),
      null,
      2
    )
  );
  for (const result of results) {
    if (result.png)
      await writeFile(
        `.artifacts/bleed/${result.name}-5mm-${test.info().project.name}.png`,
        Buffer.from(result.png.split(",")[1], "base64")
      );
  }
  for (const result of results) {
    expect(result.checked).toBeGreaterThan(10000);
    expect(
      result.nonBlack,
      `${result.name} ${result.dpi} DPI / ${result.insetMm} mm`
    ).toBe(0);
    expect(result.nonWhite, `${result.name} ${result.dpi}`).toBe(0);
    expect(result.changedArt, `${result.name} ${result.dpi}`).toBe(0);
    if (result.name === "elas-il-kor")
      expect(result.artFraction).toBeGreaterThan(0.2);
  }
});

test("full white borders stay white and mixed black/art corner joins remain continuous", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const source = document.createElement("canvas");
    source.width = 630;
    source.height = 880;
    const ctx = source.getContext("2d")!;
    ctx.fillStyle = "#ebe8e1";
    ctx.fillRect(0, 0, 630, 880);
    ctx.fillStyle = "#cc4433";
    ctx.fillRect(30, 30, 570, 820);
    const white = await (window as any).CardRenderer.renderCardCanvas(
      source.toDataURL(),
      5,
      false,
      254
    );
    let nonWhite = 0;
    const pixels = white
      .getContext("2d")
      .getImageData(0, 0, white.width, white.height).data;
    for (let y = 0; y < white.height; y++)
      for (let x = 0; x < white.width; x++) {
        if (Math.max(49 - x, x - 680, 49 - y, y - 930) <= 2) continue;
        const i = (y * white.width + x) * 4;
        if (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255)
          nonWhite++;
      }
    ctx.fillStyle = "#55aacd";
    ctx.fillRect(0, 0, 630, 880);
    ctx.fillStyle = "#181818";
    ctx.fillRect(0, 0, 630, 15);
    const mixed = await (window as any).CardRenderer.renderCardCanvas(
      source.toDataURL(),
      5,
      false,
      254
    );
    const data = mixed
      .getContext("2d")
      .getImageData(0, 0, mixed.width, mixed.height).data;
    let seamJump = 0;
    for (let i = 0; i < 50; i++)
      for (let c = 0; c < 3; c++) {
        seamJump = Math.max(
          seamJump,
          Math.abs(
            data[(i * mixed.width + 49) * 4 + c] -
              data[(i * mixed.width + 50) * 4 + c]
          )
        );
        seamJump = Math.max(
          seamJump,
          Math.abs(
            data[(49 * mixed.width + i) * 4 + c] -
              data[(50 * mixed.width + i) * 4 + c]
          )
        );
      }
    return { nonWhite, seamJump };
  });
  expect(result.nonWhite).toBe(0);
  expect(result.seamJump).toBe(0);
});

test("thin partial black borders extend black and surrounding art stays intact", async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 630;
    c.height = 880;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#f0cf73";
    ctx.fillRect(0, 0, 630, 880);
    ctx.fillStyle = "#121212";
    ctx.fillRect(0, 200, 8, 200);
    const src = c.toDataURL(),
      results = [];
    for (const insetMm of [0, 0.25, 0.5])
      for (const dpi of [200, 1200]) {
        const output = await (window as any).CardRenderer.renderCardCanvas(
          src,
          5,
          false,
          dpi,
          { artwork: { source: "scan", insetMm } }
        );
        const ppm = dpi / 25.4,
          b = Math.round(5 * ppm);
        const pixels = output
          .getContext("2d")
          .getImageData(0, 0, output.width, output.height).data;
        let nonBlack = 0;
        for (let y = Math.ceil(b + 21 * ppm); y < b + 39 * ppm; y++)
          for (let x = 0; x < b - Math.ceil(0.2 * ppm) - 1; x++) {
            const p = (y * output.width + x) * 4;
            if (pixels[p] || pixels[p + 1] || pixels[p + 2]) nonBlack++;
          }
        const p = Math.floor(b + 50 * ppm) * output.width * 4;
        results.push({
          insetMm,
          dpi,
          nonBlack,
          art: Array.from(pixels.slice(p, p + 3)),
        });
        output.width = output.height = 0;
      }
    return results;
  });
  for (const r of results) {
    expect(r.nonBlack, JSON.stringify(r)).toBe(0);
    expect(r.art).toEqual([240, 207, 115]);
  }
});

test("aged speckled frames, wider opaque corner cutouts and broad shadows have controlled remedies", async ({
  page,
}) => {
  const metrics = await page.evaluate(async () => {
    const renderer = (window as any).CardRenderer;
    const c = document.createElement("canvas");
    c.width = 1260;
    c.height = 1760;
    const ctx = c.getContext("2d")!,
      results = [];
    for (const color of ["#2a2826", "#6b6865", "#3c2e1e"]) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = "#339966";
      ctx.fillRect(60, 60, 1140, 1640);
      ctx.fillStyle = "#d8d4cc";
      for (let y = 120; y < 1760; y += 120) ctx.fillRect(6, y, 6, 5);
      // A tiny scratch spanning the entire sampled depth must not make the
      // whole faded frame fall back to mirroring the colorful inner artwork.
      ctx.fillRect(0, 600, 20, 2);
      const o = await renderer.renderCardCanvas(c.toDataURL(), 5, false, 254);
      const p = o.getContext("2d").getImageData(0, 150, 45, 680).data;
      let nonBlack = 0;
      for (let i = 0; i < p.length; i++) if (i % 4 !== 3 && p[i]) nonBlack++;
      results.push({ color, nonBlack });
      o.width = o.height = 0;
    }
    for (const bed of ["#f4f4f4", "#000000"]) {
      ctx.fillStyle = bed;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = "#5096be";
      ctx.beginPath();
      ctx.roundRect(0, 0, c.width, c.height, 3.175 * 20);
      ctx.fill();
      const src = c.toDataURL();
      for (const dpi of [200, 1200]) {
        const o = await renderer.renderCardCanvas(src, 5, false, dpi, {
          artwork: { source: "scan", insetMm: 0.25, cornerRadiusMm: 3.2 },
        });
        const size = Math.ceil((9 * dpi) / 25.4),
          p = o.getContext("2d").getImageData(0, 0, size, size).data;
        let maxError = 0;
        for (let i = 0; i < p.length; i++)
          maxError = Math.max(
            maxError,
            Math.abs(p[i] - [80, 150, 190, 255][i % 4])
          );
        results.push({ bed, dpi, maxError });
        o.width = o.height = 0;
      }
    }
    ctx.fillStyle = "#5096be";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#808080";
    ctx.fillRect(c.width - 16, 0, 16, c.height);
    const o = await renderer.renderCardCanvas(c.toDataURL(), 5, false, 254, {
      artwork: { source: "scan", insetMm: 1 },
    });
    const p = o.getContext("2d").getImageData(o.width - 60, 450, 60, 4).data;
    let shadowError = 0;
    for (let i = 0; i < p.length; i++)
      shadowError = Math.max(
        shadowError,
        Math.abs(p[i] - [80, 150, 190, 255][i % 4])
      );
    results.push({ shadowError });
    return results;
  });
  for (const r of metrics) {
    if ("nonBlack" in r) expect(r.nonBlack, JSON.stringify(r)).toBe(0);
    if ("maxError" in r)
      expect(r.maxError, JSON.stringify(r)).toBeLessThanOrEqual(1);
    if ("shadowError" in r) expect(r.shadowError).toBe(0);
  }
});

test("real MPC cardback retains its supplied artwork and extends only the extra black bleed", async ({
  page,
}) => {
  const src =
    "data:image/png;base64," +
    (
      await readFile(
        new URL("./fixtures/mpc-simple-lotus.png", import.meta.url)
      )
    ).toString("base64");
  const result = await page.evaluate(async (src) => {
    const render = (window as any).CardRenderer.renderCardCanvas;
    const original = await render(src, 3, true, 254),
      extended = await render(src, 5, true, 254, {
        artwork: { source: "scan", insetMm: 1, cornerRadiusMm: 3.5 },
      });
    const a = original
      .getContext("2d")
      .getImageData(0, 0, original.width, original.height).data;
    const b = extended
      .getContext("2d")
      .getImageData(20, 20, original.width, original.height).data;
    let changed = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
    const p = extended
      .getContext("2d")
      .getImageData(0, 0, extended.width, extended.height).data;
    let nonBlack = 0;
    for (let y = 0; y < extended.height; y++)
      for (let x = 0; x < extended.width; x++) {
        if (
          Math.max(
            19 - x,
            x - (20 + original.width),
            19 - y,
            y - (20 + original.height)
          ) <= 2
        )
          continue;
        const i = (y * extended.width + x) * 4;
        if (p[i] || p[i + 1] || p[i + 2]) nonBlack++;
      }
    return { changed, nonBlack, png: extended.toDataURL() };
  }, src);
  expect(result.changed).toBe(0);
  expect(result.nonBlack).toBe(0);
  await writeFile(
    `.artifacts/bleed/mpc-simple-lotus-5mm-${test.info().project.name}.png`,
    Buffer.from(result.png.split(",")[1], "base64")
  );
});

test("6000-pixel uploads stay within the canvas area budget and cancel between repair slices", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const source = document.createElement("canvas");
    source.width = 6000;
    source.height = 8381;
    const ctx = source.getContext("2d")!;
    ctx.fillStyle = "#5096be";
    ctx.fillRect(0, 0, source.width, source.height);
    const src = source.toDataURL();
    source.width = source.height = 0;
    const original = HTMLCanvasElement.prototype.getContext;
    const canvases = new Set<HTMLCanvasElement>();
    let largest = 0,
      calls = 0,
      cancelOnBand = false;
    const controller = new AbortController();
    HTMLCanvasElement.prototype.getContext = function (...args: any[]) {
      const area = this.width * this.height;
      largest = Math.max(largest, area);
      canvases.add(this);
      if (area > 16_777_216)
        throw new Error("Renderer exceeded the canvas area budget");
      if (cancelOnBand && ++calls === 3)
        setTimeout(() => controller.abort(), 0);
      return (original as any).apply(this, args);
    } as typeof original;
    try {
      const output = await (window as any).CardRenderer.renderCardCanvas(
        src,
        5,
        false,
        1200
      );
      await (window as any).CardRenderer.canvasToBlob(
        output,
        "image/jpeg",
        0.96
      );
      output.width = output.height = 0;
      cancelOnBand = true;
      let cancelled = false;
      try {
        await (window as any).CardRenderer.renderCardCanvas(
          src,
          5,
          false,
          1200,
          { signal: controller.signal }
        );
      } catch (error) {
        cancelled =
          error instanceof DOMException && error.name === "AbortError";
      }
      return {
        largest,
        cancelled,
        released: [...canvases].every((c) => c.width === 0 && c.height === 0),
      };
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });
  expect(result.largest).toBeLessThanOrEqual(16_777_216);
  expect(result.cancelled).toBe(true);
  expect(result.released).toBe(true);
});

test("Arasta keeps its original interior and has matching pixels at all four bleed seams", async ({
  page,
}) => {
  const src =
    "data:image/png;base64," +
    (
      await readFile(new URL("./fixtures/arasta.png", import.meta.url))
    ).toString("base64");
  const results = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const results = [];
    for (const dpi of [300, 1200]) {
      const rendered = await (window as any).CardRenderer.renderCardCanvas(
        src,
        2,
        false,
        dpi
      );
      const b = Math.round((2 * dpi) / 25.4),
        w = Math.round((63 * dpi) / 25.4),
        h = Math.round((88 * dpi) / 25.4);
      const expected = document.createElement("canvas");
      expected.width = w;
      expected.height = h;
      const ctx = expected.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(image, 0, 0, w, h);
      const reference = ctx.getImageData(0, 0, w, h).data;
      const out = rendered
        .getContext("2d")
        .getImageData(0, 0, rendered.width, rendered.height).data;
      const pitch = rendered.width;
      let difference = 0,
        count = 0,
        maxDifference = 0,
        seamJump = 0;
      // Leave four original pixels of resampling support inside the safe mask.
      const inset = 0.25 + (4 * 63) / image.width,
        r = 2.5 - inset;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const u = (Math.min(x + 0.5, w - x - 0.5) * 63) / w,
            v = (Math.min(y + 0.5, h - y - 0.5) * 88) / h;
          if (
            u < inset ||
            v < inset ||
            (u < 2.5 && v < 2.5 && (u - 2.5) ** 2 + (v - 2.5) ** 2 > r * r)
          )
            continue;
          for (let c = 0; c < 3; c++) {
            const delta = Math.abs(
              reference[(y * w + x) * 4 + c] -
                out[((y + b) * pitch + x + b) * 4 + c]
            );
            difference += delta;
            count++;
            maxDifference = Math.max(maxDifference, delta);
          }
        }
      for (let y = 0; y < rendered.height; y++)
        for (const x of [b, b + w])
          for (let c = 0; c < 3; c++)
            seamJump = Math.max(
              seamJump,
              Math.abs(
                out[(y * pitch + x - 1) * 4 + c] - out[(y * pitch + x) * 4 + c]
              )
            );
      for (let x = 0; x < rendered.width; x++)
        for (const y of [b, b + h])
          for (let c = 0; c < 3; c++)
            seamJump = Math.max(
              seamJump,
              Math.abs(
                out[((y - 1) * pitch + x) * 4 + c] -
                  out[(y * pitch + x) * 4 + c]
              )
            );
      results.push({
        dpi,
        meanDifference: difference / count,
        maxDifference,
        seamJump,
      });
      rendered.width = rendered.height = expected.width = expected.height = 0;
    }
    return results;
  }, src);
  await mkdir(".artifacts/bleed", { recursive: true });
  await writeFile(
    `.artifacts/bleed/preservation-${test.info().project.name}.json`,
    JSON.stringify(results, null, 2)
  );
  for (const result of results) {
    expect(result.meanDifference).toBeLessThan(0.1);
    expect(result.maxDifference).toBeLessThanOrEqual(2);
    expect(result.seamJump).toBe(0);
  }
});

test("non-card aspect ratios retain cover fitting instead of stretching artwork", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 800;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, 800, 800);
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(400, 400, 200, 0, 2 * Math.PI);
    ctx.fill();
    const results = [];
    for (const source of ["scan", "square"]) {
      const output = await (window as any).CardRenderer.renderCardCanvas(
        canvas.toDataURL(),
        0,
        false,
        300,
        { artwork: { source, insetMm: 0.25 } }
      );
      const pixels = output
        .getContext("2d")
        .getImageData(0, 0, output.width, output.height).data;
      let across = 0,
        down = 0;
      for (let x = 0; x < output.width; x++)
        if (
          pixels[(Math.floor(output.height / 2) * output.width + x) * 4] > 128
        )
          across++;
      for (let y = 0; y < output.height; y++)
        if (pixels[(y * output.width + Math.floor(output.width / 2)) * 4] > 128)
          down++;
      results.push({ across, down });
      output.width = output.height = 0;
    }
    return results;
  });
  for (const { across, down } of result)
    expect(Math.abs(across / down - 1)).toBeLessThan(0.005);
});

test("odd source dimensions cannot mix excluded scan colors into artwork", async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const results = [];
    for (const [width, height] of [
      [630, 880],
      [630, 881],
      [744, 1040],
      [745, 1041],
      [200, 281],
    ]) {
      const input = document.createElement("canvas");
      input.width = width;
      input.height = height;
      const ctx = input.getContext("2d")!;
      const sources = [];
      for (const poison of [
        [255, 0, 255, 255],
        [0, 255, 0, 255],
        [255, 0, 0, 0],
      ]) {
        const pixels = ctx.createImageData(width, height);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const u = (Math.min(x + 0.5, width - x - 0.5) * 63) / width,
              v = (Math.min(y + 0.5, height - y - 0.5) * 88) / height;
            const valid =
              u >= 0.25 &&
              v >= 0.25 &&
              (u >= 2.5 ||
                v >= 2.5 ||
                (2.5 - u) ** 2 + (2.5 - v) ** 2 <= 2.25 ** 2);
            pixels.data.set(
              valid ? [80, 150, 190, 255] : poison,
              (y * width + x) * 4
            );
          }
        ctx.putImageData(pixels, 0, 0);
        sources.push(input.toDataURL());
      }
      for (const dpi of [200, 600]) {
        let reference: Uint8ClampedArray | undefined;
        let differences = 0;
        for (const src of sources) {
          const output = await (window as any).CardRenderer.renderCardCanvas(
            src,
            2,
            false,
            dpi
          );
          const data = output
            .getContext("2d")
            .getImageData(0, 0, output.width, output.height).data;
          if (reference) {
            for (let i = 0; i < data.length; i++)
              if (data[i] !== reference[i]) differences++;
          }
          if (!reference) reference = data;
          output.width = output.height = 0;
        }
        results.push({ width, height, dpi, differences });
      }
      input.width = input.height = 0;
    }
    return results;
  });
  for (const result of results)
    expect(result.differences, JSON.stringify(result)).toBe(0);
});

test("square mode preserves each original corner; scan margin excludes a wider rim", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const input = document.createElement("canvas");
    input.width = 630;
    input.height = 880;
    const ctx = input.getContext("2d")!;
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, 630, 880);
    ctx.fillStyle = "#5096be";
    ctx.fillRect(4, 4, 622, 872);
    const src = input.toDataURL();
    const values = [];
    for (const options of [
      { source: "square", insetMm: 0.5 },
      { source: "scan", insetMm: 0 },
      { source: "scan", insetMm: 0.5 },
    ]) {
      const output = await (window as any).CardRenderer.renderCardCanvas(
        src,
        0,
        false,
        254,
        { artwork: options }
      );
      const out = output.getContext("2d");
      values.push({
        corner: Array.from(out.getImageData(0, 0, 1, 1).data),
        edge: Array.from(out.getImageData(0, 440, 1, 1).data),
      });
      output.width = output.height = 0;
    }
    return values;
  });
  expect(result[0].corner).toEqual([255, 0, 255, 255]);
  expect(result[0].edge).toEqual([255, 0, 255, 255]);
  expect(result[1].edge).toEqual([255, 0, 255, 255]);
  expect(result[2].corner).toEqual([80, 150, 190, 255]);
  expect(result[2].edge).toEqual([80, 150, 190, 255]);
});

test("texture diversity contact sheet and seam coverage at 0, 2 and 5 mm", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const names = [
      "Gradient",
      "Diagonal lines",
      "Fine texture",
      "Near-corner text",
      "Dark left / bright top",
      "Four different borders",
    ];
    const sheet = document.createElement("canvas");
    sheet.width = 1080;
    sheet.height = names.length * 230;
    const out = sheet.getContext("2d")!;
    out.fillStyle = "#ddd";
    out.fillRect(0, 0, sheet.width, sheet.height);
    let nonOpaque = 0,
      nonBlackThinBorder = 0,
      maxFlatSeamJump = 0;
    for (let kind = 0; kind < names.length; kind++) {
      const input = document.createElement("canvas");
      input.width = 630;
      input.height = 880;
      const ctx = input.getContext("2d")!;
      const gradient = ctx.createLinearGradient(0, 0, 630, 880);
      gradient.addColorStop(0, "#f0cf73");
      gradient.addColorStop(0.5, "#5493af");
      gradient.addColorStop(1, "#b36750");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 630, 880);
      if (kind === 1) {
        ctx.strokeStyle = "#553828";
        ctx.lineWidth = 2;
        for (let x = -900; x < 700; x += 14) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x + 880, 880);
          ctx.stroke();
        }
      }
      if (kind === 2) {
        for (let y = 0; y < 880; y += 3)
          for (let x = 0; x < 630; x += 3) {
            ctx.fillStyle = `rgba(20,30,40,${((x * 37 + y * 17) % 101) / 500})`;
            ctx.fillRect(x, y, 2, 2);
          }
      }
      if (kind === 3) {
        ctx.fillStyle = "#111";
        ctx.font = "bold 14px sans-serif";
        ctx.fillText("ART 123", 8, 17);
        ctx.fillText("ART 123", 550, 17);
      }
      if (kind === 4) {
        ctx.fillStyle = "#121212";
        ctx.fillRect(0, 0, 8, 880);
      }
      if (kind === 5) {
        for (const [x, y, c] of [
          [0, 0, "#f4d354"],
          [315, 0, "#2c7fbe"],
          [0, 440, "#c83c36"],
          [315, 440, "#0e0f10"],
        ] as const) {
          ctx.fillStyle = c;
          ctx.fillRect(x, y, 315, 440);
        }
      }
      const pixels = ctx.getImageData(0, 0, 630, 880);
      for (let y = 0; y < 880; y++)
        for (let x = 0; x < 630; x++) {
          const u = Math.min(x + 0.5, 629.5 - x) / 10,
            v = Math.min(y + 0.5, 879.5 - y) / 10;
          if (
            u < 0.2 ||
            v < 0.2 ||
            (u < 2.5 && v < 2.5 && (u - 2.5) ** 2 + (v - 2.5) ** 2 > 2.3 ** 2)
          )
            pixels.data.set([0, 0, 0, 255], (y * 630 + x) * 4);
        }
      ctx.putImageData(pixels, 0, 0);
      for (const [column, bleed] of [0, 2, 5].entries()) {
        const rendered = await (window as any).CardRenderer.renderCardCanvas(
          input.toDataURL(),
          bleed,
          false,
          254
        );
        const data = rendered
          .getContext("2d")
          .getImageData(0, 0, rendered.width, rendered.height).data;
        for (let i = 3; i < data.length; i += 4)
          if (data[i] !== 255) nonOpaque++;
        if (kind === 5 && bleed) {
          const b = bleed * 10;
          for (let y = 0; y < rendered.height; y++)
            for (let c = 0; c < 3; c++)
              maxFlatSeamJump = Math.max(
                maxFlatSeamJump,
                Math.abs(
                  data[(y * rendered.width + b - 1) * 4 + c] -
                    data[(y * rendered.width + b) * 4 + c]
                )
              );
        }
        if (kind === 4 && bleed) {
          const b = bleed * 10;
          for (let y = b + 30; y < b + 850; y++)
            for (let x = 0; x < b - 3; x++) {
              const p = (y * rendered.width + x) * 4;
              if (data[p] || data[p + 1] || data[p + 2]) nonBlackThinBorder++;
            }
        }
        const crop = 65 + bleed * 10;
        out.drawImage(
          rendered,
          0,
          0,
          crop,
          crop,
          column * 360,
          kind * 230 + 30,
          175,
          195
        );
        out.drawImage(
          rendered,
          rendered.width - crop,
          0,
          crop,
          crop,
          column * 360 + 180,
          kind * 230 + 30,
          175,
          195
        );
        out.fillStyle = "#111";
        out.font = "16px sans-serif";
        out.fillText(
          `${names[kind]} · ${bleed} mm · TL/TR`,
          column * 360 + 5,
          kind * 230 + 20
        );
        rendered.width = rendered.height = 0;
      }
      input.width = input.height = 0;
    }
    return {
      png: sheet.toDataURL(),
      nonOpaque,
      nonBlackThinBorder,
      maxFlatSeamJump,
    };
  });
  await test.info().attach("texture-diversity", {
    body: Buffer.from(result.png.split(",")[1], "base64"),
    contentType: "image/png",
  });
  await mkdir(".artifacts/bleed", { recursive: true });
  await writeFile(
    `.artifacts/bleed/diversity-${test.info().project.name}.png`,
    Buffer.from(result.png.split(",")[1], "base64")
  );
  expect(result.nonOpaque).toBe(0);
  expect(result.nonBlackThinBorder).toBe(0);
  expect(result.maxFlatSeamJump).toBe(0);
});

test("real scan artwork is unchanged when its excluded shadow and scanner bed become opaque noise", async ({
  page,
}) => {
  for (const name of ["arasta", "fireball"]) {
    const src =
      "data:image/png;base64," +
      (
        await readFile(new URL(`./fixtures/${name}.png`, import.meta.url))
      ).toString("base64");
    const result = await page.evaluate(async (src) => {
      const render = (window as any).CardRenderer.renderCardCanvas;
      const image = new Image();
      image.src = src;
      await image.decode();
      const c = document.createElement("canvas");
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, c.width, c.height);
      let replaced = 0;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          const mx = ((x + 0.5) * 63) / c.width,
            my = ((y + 0.5) * 88) / c.height;
          const cx = Math.max(2.5, Math.min(60.5, mx)),
            cy = Math.max(2.5, Math.min(85.5, my));
          const trusted =
            mx >= 0.25 &&
            mx <= 62.75 &&
            my >= 0.25 &&
            my <= 87.75 &&
            Math.hypot(mx - cx, my - cy) <= 2.25;
          if (trusted) continue;
          const p = (y * c.width + x) * 4;
          for (let channel = 0; channel < 3; channel++)
            pixels.data[p + channel] = (x * 31 + y * 73 + channel * 107) % 256;
          pixels.data[p + 3] = 255;
          replaced++;
        }
      ctx.putImageData(pixels, 0, 0);
      const a = await render(src, 5, false, 254);
      const b = await render(c.toDataURL(), 5, false, 254);
      const ap = a.getContext("2d").getImageData(0, 0, a.width, a.height).data;
      const bp = b.getContext("2d").getImageData(0, 0, b.width, b.height).data;
      let max = 0,
        changed = 0;
      for (let i = 0; i < ap.length; i++) {
        max = Math.max(max, Math.abs(ap[i] - bp[i]));
        if (ap[i] !== bp[i]) changed++;
      }
      a.width = a.height = b.width = b.height = c.width = c.height = 0;
      return { replaced, max, changed };
    }, src);
    expect(result.replaced, name).toBeGreaterThan(1000);
    expect(result.max, name).toBe(0);
  }
});

test("lifted real black footers retain black bleed without flattening nearby artwork", async ({
  page,
}, testInfo) => {
  for (const name of ["arasta", "hit-it", "elas-il-kor"]) {
    const src =
      "data:image/png;base64," +
      (
        await readFile(new URL(`./fixtures/${name}.png`, import.meta.url))
      ).toString("base64");
    const results = await page.evaluate(
      async ({ src, name }) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const c = document.createElement("canvas");
        c.width = image.width;
        c.height = image.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        const original = ctx.getImageData(0, 0, c.width, c.height);
        const results = [];
        for (const lift of [15, 25, 35]) {
          const edited = new ImageData(
            new Uint8ClampedArray(original.data),
            c.width,
            c.height
          );
          for (let p = 0; p < edited.data.length; p += 4)
            if (
              Math.max(edited.data[p], edited.data[p + 1], edited.data[p + 2]) <
              45
            )
              for (let channel = 0; channel < 3; channel++)
                edited.data[p + channel] += lift;
          ctx.putImageData(edited, 0, 0);
          const altered = c.toDataURL();
          const render = (window as any).CardRenderer.renderCardCanvas;
          const output = await render(altered, 5, false, 254);
          const mirror = await render(altered, 5, false, 254, {
            artwork: { source: "scan", insetMm: 0.25, borders: "mirror" },
          });
          const a = output
            .getContext("2d")
            .getImageData(0, 0, output.width, output.height).data;
          const b = mirror
            .getContext("2d")
            .getImageData(0, 0, mirror.width, mirror.height).data;
          let nonBlack = 0,
            artChanged = 0;
          const checkBlack = (x: number, y: number) => {
            const p = (Math.round(y) * output.width + Math.round(x)) * 4;
            if (a[p] || a[p + 1] || a[p + 2]) nonBlack++;
          };
          for (let mm = 3; mm <= 60; mm += 0.25) {
            checkBlack(50 + mm * 10, 950);
            if (name === "hit-it") checkBlack(50 + mm * 10, 30);
          }
          if (name === "hit-it") {
            for (let mm = 60; mm <= 83; mm += 0.25) {
              checkBlack(30, 50 + mm * 10);
              checkBlack(700, 50 + mm * 10);
            }
          }
          // A full-width footer also reaches both side edges. Its bottom
          // border must support those short runs and the complete corner tiles.
          for (let mm = 82; mm <= 85; mm += 0.25) {
            checkBlack(30, 50 + mm * 10);
            checkBlack(700, 50 + mm * 10);
          }
          for (let y = 930; y < output.height; y++)
            for (let x = 0; x < 50; x++) {
              // The first 0.2 mm deliberately blends the original scan tone.
              if (Math.max(49 - x, y - 930) < 2) continue;
              checkBlack(x, y);
              checkBlack(output.width - 1 - x, y);
            }
          if (name !== "arasta") {
            const first = name === "hit-it" ? 11 : 3,
              last = name === "hit-it" ? 48 : 79;
            for (let y = 50 + first * 10; y < 50 + last * 10; y++)
              for (let x = 0; x < 50; x++)
                for (const px of [x, output.width - 1 - x]) {
                  const p = (y * output.width + px) * 4;
                  for (let k = 0; k < 4; k++)
                    if (a[p + k] !== b[p + k]) artChanged++;
                }
          }
          results.push({
            lift,
            nonBlack,
            artChanged,
            preview: lift === 35 ? output.toDataURL() : undefined,
          });
          output.width = output.height = mirror.width = mirror.height = 0;
        }
        c.width = c.height = 0;
        return results;
      },
      { src, name }
    );
    for (const result of results) {
      expect(result.nonBlack, `${name} lift ${result.lift}`).toBe(0);
      expect(result.artChanged, `${name} lift ${result.lift} artwork`).toBe(0);
      if (result.preview)
        await writeFile(
          `.artifacts/bleed/${name}-lift35-${testInfo.project.name}.png`,
          Buffer.from(result.preview.split(",")[1], "base64")
        );
    }
  }
});

test("real Beta frame wear and raised scan black levels retain black edge bleed", async ({
  page,
}, testInfo) => {
  const src =
    "data:image/png;base64," +
    (
      await readFile(new URL("./fixtures/fireball.png", import.meta.url))
    ).toString("base64");
  const results = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext("2d")!;
    const results = [];
    for (const lift of [4, 8, 15])
      for (const chipMm of [1, 2])
        for (const chipTone of [140, 200]) {
          ctx.drawImage(image, 0, 0);
          ctx.fillStyle = `rgb(${chipTone},${chipTone},${chipTone})`;
          ctx.fillRect(
            0,
            Math.floor((30 * c.height) / 88),
            Math.ceil((1.2 * c.width) / 63),
            Math.ceil((chipMm * c.height) / 88)
          );
          const pixels = ctx.getImageData(0, 0, c.width, c.height);
          for (let p = 0; p < pixels.data.length; p += 4)
            for (let k = 0; k < 3; k++)
              pixels.data[p + k] += lift * (1 - pixels.data[p + k] / 255);
          ctx.putImageData(pixels, 0, 0);
          const output = await (window as any).CardRenderer.renderCardCanvas(
            c.toDataURL(),
            5,
            false,
            254
          );
          const a = output
            .getContext("2d")
            .getImageData(0, 0, output.width, output.height).data;
          let nonBlack = 0;
          const black = (x: number, y: number) => {
            const p = (Math.round(y) * output.width + Math.round(x)) * 4;
            if (a[p] || a[p + 1] || a[p + 2]) nonBlack++;
          };
          for (let mm = 3; mm <= 60; mm += 0.25) {
            black(50 + mm * 10, 30);
            black(50 + mm * 10, 950);
          }
          for (let mm = 3; mm <= 85; mm += 0.25) {
            black(700, 50 + mm * 10);
            if (mm < 27 || mm > 36) black(30, 50 + mm * 10);
          }
          results.push({
            lift,
            chipMm,
            chipTone,
            nonBlack,
            preview:
              lift === 15 && chipMm === 2 && chipTone === 200
                ? output.toDataURL()
                : undefined,
          });
          output.width = output.height = 0;
        }
    c.width = c.height = 0;
    return results;
  }, src);
  for (const result of results) {
    expect(
      result.nonBlack,
      JSON.stringify({
        lift: result.lift,
        chipMm: result.chipMm,
        tone: result.chipTone,
      })
    ).toBe(0);
    if (result.preview)
      await writeFile(
        `.artifacts/bleed/fireball-worn-lift15-${testInfo.project.name}.png`,
        Buffer.from(result.preview.split(",")[1], "base64")
      );
  }
});
