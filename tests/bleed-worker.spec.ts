import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const requireClient = createRequire(
  new URL("../client/package.json", import.meta.url)
);
const assets = new Map<string, string | Uint8Array>();
let entry: string;

test.beforeAll(async () => {
  const { build } = requireClient("vite");
  const helpers = fileURLToPath(
    new URL("../client/src/helpers/", import.meta.url)
  );
  const result = await build({
    configFile: false,
    logLevel: "silent",
    base: "/bleed-worker-harness/",
    plugins: [
      {
        name: "bleed-harness",
        resolveId(id: string) {
          if (id.endsWith("bleed-harness")) return "\0bleed-harness";
        },
        load(id: string) {
          if (id === "\0bleed-harness")
            return `export {renderCardImage} from ${JSON.stringify(helpers + "renderCardImage.ts")}; export {renderCardCanvas,canvasToBlob} from ${JSON.stringify(helpers + "canvasProcessing.ts")};`;
        },
      },
    ],
    build: {
      write: false,
      lib: { entry: "bleed-harness", name: "BleedHarness", formats: ["iife"] },
    },
  });
  for (const output of (Array.isArray(result) ? result : [result]).flatMap(
    (r: any) => r.output
  )) {
    assets.set(
      output.fileName,
      output.type === "chunk" ? output.code : output.source
    );
    if (output.type === "chunk" && output.isEntry) entry = output.fileName;
  }
});
test.beforeEach(async ({ page }) => {
  await page.route("**/bleed-worker-harness-page", (route) =>
    route.fulfill({
      body: "<!doctype html><html><body></body></html>",
      contentType: "text/html",
    })
  );
  await page.route("**/bleed-worker-harness/**", (route) => {
    const file = new URL(route.request().url()).pathname.replace(
      "/bleed-worker-harness/",
      ""
    );
    const body = assets.get(file);
    return body === undefined
      ? route.abort()
      : route.fulfill({
          body: typeof body === "string" ? body : Buffer.from(body),
          contentType: "application/javascript",
        });
  });
  await page.goto("/bleed-worker-harness-page");
  await page.addScriptTag({ url: `/bleed-worker-harness/${entry}` });
  await page.evaluate(() => {
    const NativeWorker = Worker;
    (window as any).workerLog = { starts: 0, stops: 0, messages: [], ids: [] };
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        (window as any).workerLog.starts++;
        this.addEventListener("message", (event) =>
          (window as any).workerLog.messages.push(event.data.kind)
        );
      }
      terminate() {
        (window as any).workerLog.stops++;
        super.terminate();
      }
      postMessage(message: any, transfer: Transferable[]) {
        (window as any).workerLog.ids.push(message.id);
        super.postMessage(message, transfer);
      }
    };
  });
});

test("worker rendering preserves the same card pixels, borders and supplied MPC bleed", async ({
  page,
  browserName,
}) => {
  const metrics = [];
  for (const name of [
    "arasta",
    "fireball",
    "hit-it",
    "elas-il-kor",
    "white-border-lightning-bolt",
    "mpc-simple-lotus",
  ]) {
    const src =
      "data:image/png;base64," +
      (
        await readFile(new URL(`./fixtures/${name}.png`, import.meta.url))
      ).toString("base64");
    for (const dpi of [200, 1200]) {
      const result = await page.evaluate(
        async ({ name, src, dpi }) => {
          const h = (window as any).BleedHarness;
          const main = await h.renderCardCanvas(
            src,
            5,
            name.startsWith("mpc"),
            dpi
          );
          const result = await h.renderCardImage(
            src,
            5,
            name.startsWith("mpc"),
            dpi,
            { type: "image/png" }
          );
          const bitmap = await createImageBitmap(result.blob);
          const c = document.createElement("canvas");
          c.width = main.width;
          c.height = main.height;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          const a = main
            .getContext("2d")
            .getImageData(0, 0, main.width, main.height).data;
          const b = ctx.getImageData(0, 0, c.width, c.height).data;
          let max = 0,
            sum = 0,
            changed = 0;
          for (let i = 0; i < a.length; i++) {
            const d = Math.abs(a[i] - b[i]);
            max = Math.max(max, d);
            sum += d;
            if (d) changed++;
          }
          main.width = main.height = c.width = c.height = 0;
          return {
            name,
            dpi,
            max,
            mean: sum / a.length,
            changed,
            report: result.report,
          };
        },
        { name, src, dpi }
      );
      metrics.push(result);
    }
  }
  await mkdir(".artifacts/bleed", { recursive: true });
  await writeFile(
    `.artifacts/bleed/worker-parity-${browserName}.json`,
    JSON.stringify(metrics, null, 2)
  );
  for (const result of metrics) {
    expect(result.max, JSON.stringify(result)).toBe(0);
    expect(result.changed, JSON.stringify(result)).toBe(0);
  }
  const log = await page.evaluate(() => (window as any).workerLog);
  expect(log.starts).toBe(1);
  expect(log.stops).toBe(0);
  expect(new Set(log.ids).size).toBe(12);
  expect(log.messages).toEqual(Array(12).fill("done"));
});

test("worker cancellation terminates the render and unsupported browsers retain the canvas fallback", async ({
  page,
}) => {
  const src =
    "data:image/png;base64," +
    (
      await readFile(new URL("./fixtures/arasta.png", import.meta.url))
    ).toString("base64");
  const result = await page.evaluate(async (src) => {
    const h = (window as any).BleedHarness;
    const NativeWorker = Worker;
    const abort = new AbortController();
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        setTimeout(() => abort.abort(), 0);
      }
    };
    let aborted = false;
    try {
      await h.renderCardImage(src, 5, false, 1200, { signal: abort.signal });
    } catch (error) {
      aborted = error instanceof DOMException && error.name === "AbortError";
    }
    const stopped = (window as any).workerLog.stops;
    // A worker-blocking browser policy must retain a usable preview and export.
    window.Worker = class {
      constructor() {
        throw new Error("Workers disabled");
      }
    } as any;
    const fallback = await h.renderCardImage(src, 5, false, 200);
    const bitmap = await createImageBitmap(fallback.blob);
    const dimensions = [bitmap.width, bitmap.height];
    bitmap.close();
    window.Worker = NativeWorker;
    return { aborted, stopped, dimensions, report: fallback.report };
  }, src);
  expect(result.aborted).toBe(true);
  expect(result.stopped).toBe(1);
  expect(result.dimensions).toEqual([574, 771]);
  expect(result.report.kind).toBe("auto");
});

test("concurrent preview and PDF requests share one decode/render slot and keep their own results", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = (window as any).BleedHarness;
    const jobs = [
      { dpi: 200, bleed: 2, rgb: [19, 121, 232] },
      { dpi: 1200, bleed: 5, rgb: [215, 74, 33] },
      { dpi: 300, bleed: 0, rgb: [87, 189, 45] },
    ];
    const sources = jobs.map(({ rgb }) => {
      const c = document.createElement("canvas");
      c.width = 630;
      c.height = 880;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = `rgb(${rgb.join(",")})`;
      ctx.fillRect(0, 0, c.width, c.height);
      const src = c.toDataURL();
      c.width = c.height = 0;
      return src;
    });
    let active = 0,
      maxActive = 0,
      decodeDuringWorker = 0,
      decodes = 0;
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      decodes++;
      if (active) decodeDuringWorker++;
      return decode.call(this);
    };
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args: any[]) {
      active++;
      maxActive = Math.max(maxActive, active);
      this.addEventListener("message", () => active--, { once: true });
      return (post as any).apply(this, args);
    };
    const reports: number[] = [];
    const results = await Promise.all(
      jobs.map(async ({ dpi, bleed }, index) => {
        const image = await h.renderCardImage(
          sources[index],
          bleed,
          false,
          dpi,
          {
            type: "image/png",
            artwork: { source: "square", insetMm: 0, borders: "mirror" },
            onReport: () => reports.push(index),
          }
        );
        const bitmap = await createImageBitmap(image.blob);
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0, 1, 1);
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        const dimensions = [bitmap.width, bitmap.height];
        bitmap.close();
        c.width = c.height = 0;
        return { rgb, dimensions, kind: image.report.kind };
      })
    );
    return {
      results,
      reports,
      decodes,
      maxActive,
      decodeDuringWorker,
      log: (window as any).workerLog,
    };
  });
  expect(result.results).toEqual([
    { rgb: [19, 121, 232], dimensions: [528, 725], kind: "mirror" },
    { rgb: [215, 74, 33], dimensions: [3448, 4629], kind: "mirror" },
    { rgb: [87, 189, 45], dimensions: [744, 1039], kind: "none" },
  ]);
  expect(result.reports.sort()).toEqual([0, 1, 2]);
  expect(result.decodes).toBe(3);
  expect(result.maxActive).toBe(1);
  expect(result.decodeDuringWorker).toBe(0);
  expect(result.log.starts).toBe(1);
  expect(result.log.stops).toBe(0);
  expect(new Set(result.log.ids).size).toBe(3);
});

test("queued cancellation rejects before decoding and active cancellation permits the next request", async ({
  page,
}) => {
  const src =
    "data:image/png;base64," +
    (
      await readFile(new URL("./fixtures/arasta.png", import.meta.url))
    ).toString("base64");
  const result = await page.evaluate(async (src) => {
    const h = (window as any).BleedHarness;
    const active = new AbortController(),
      queued = new AbortController();
    let decodes = 0,
      held = false,
      firstSettled = false;
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      decodes++;
      return decode.call(this);
    };
    let posted!: () => void;
    const firstPosted = new Promise<void>((resolve) => {
      posted = resolve;
    });
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args: any[]) {
      // Hold the first worker request open without racing the machine's speed.
      if (!held) {
        held = true;
        posted();
        return;
      }
      return (post as any).apply(this, args);
    };
    const isAbort = (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError";
    const first = h
      .renderCardImage(src, 5, false, 200, { signal: active.signal })
      .then(() => false, isAbort)
      .finally(() => {
        firstSettled = true;
      });
    await firstPosted;
    const second = h
      .renderCardImage(src, 5, false, 1200, { signal: queued.signal })
      .then(() => false, isAbort);
    await new Promise((resolve) => setTimeout(resolve, 20));
    queued.abort();
    const queuedAborted = await Promise.race([
      second,
      new Promise((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    const beforeActiveAbort = { decodes, firstSettled };
    active.abort();
    const activeAborted = await first;
    const stopsAfterAbort = (window as any).workerLog.stops;
    const recovered = await h.renderCardImage(src, 2, false, 200);
    const bitmap = await createImageBitmap(recovered.blob);
    const dimensions = [bitmap.width, bitmap.height];
    bitmap.close();
    return {
      queuedAborted,
      activeAborted,
      beforeActiveAbort,
      stopsAfterAbort,
      dimensions,
      decodes,
      log: (window as any).workerLog,
    };
  }, src);
  expect(result.queuedAborted).toBe(true);
  expect(result.beforeActiveAbort).toEqual({ decodes: 1, firstSettled: false });
  expect(result.activeAborted).toBe(true);
  expect(result.stopsAfterAbort).toBe(1);
  expect(result.dimensions).toEqual([528, 725]);
  expect(result.decodes).toBe(2);
  expect(result.log.starts).toBe(2);
  expect(result.log.stops).toBe(1);
  expect(result.log.messages).toEqual(["done"]);
});

for (const failure of [
  "constructor",
  "module",
  "source bands",
  "transfer",
  "canvas bitmap",
  "worker canvas constructor",
  "worker canvas context",
] as const) {
  test(`${failure} capability failures reuse the fetched source for the canvas fallback`, async ({
    page,
  }) => {
    if (failure === "module" || failure.startsWith("worker canvas")) {
      await page.route("**/bleed-worker-harness/**", (route) => {
        const file = new URL(route.request().url()).pathname.replace(
          "/bleed-worker-harness/",
          ""
        );
        if (!file.includes("cardRender.worker")) return route.fallback();
        const source = assets.get(file)!;
        const prefix =
          failure === "module"
            ? 'throw new Error("Module workers blocked");\n'
            : failure === "worker canvas constructor"
              ? 'self.OffscreenCanvas = class { constructor() { throw new Error("Worker canvas unavailable"); } };\n'
              : 'OffscreenCanvas.prototype.getContext = function () { throw new Error("Worker context unavailable"); };\n';
        return route.fulfill({
          body:
            prefix +
            (typeof source === "string"
              ? source
              : Buffer.from(source).toString("utf8")),
          contentType: "application/javascript",
        });
      });
    }
    const src =
      "data:image/png;base64," +
      (
        await readFile(new URL("./fixtures/arasta.png", import.meta.url))
      ).toString("base64");
    const result = await page.evaluate(
      async ({ src, failure }) => {
        const h = (window as any).BleedHarness;
        const reference = await h.renderCardCanvas(src, 5, false, 200);
        const fetch = window.fetch;
        let fetches = 0;
        window.fetch = (...args) => {
          fetches++;
          return fetch(...args);
        };
        const bitmap = window.createImageBitmap;
        if (failure === "constructor") {
          window.Worker = class {
            constructor() {
              throw new Error("Workers disabled");
            }
          } as any;
        } else if (failure === "transfer") {
          Worker.prototype.postMessage = () => {
            throw new DOMException("Transfer unavailable", "DataCloneError");
          };
        } else if (failure === "canvas bitmap") {
          window.createImageBitmap = ((...args: any[]) => {
            if (args[0] instanceof HTMLCanvasElement)
              return Promise.reject(
                new DOMException(
                  "Canvas bitmap unavailable",
                  "NotSupportedError"
                )
              );
            return (bitmap as any)(...args);
          }) as typeof bitmap;
        } else if (failure === "source bands") {
          let prepared = 0;
          window.createImageBitmap = ((...args: any[]) => {
            if (args[0] instanceof HTMLCanvasElement) prepared++;
            // Fail after the interior and two successful native bands to
            // exercise partial preparation cleanup.
            if (prepared >= 4)
              return Promise.reject(
                new DOMException(
                  "Band bitmaps unavailable",
                  "NotSupportedError"
                )
              );
            return (bitmap as any)(...args);
          }) as typeof bitmap;
        }
        const createBitmap = window.createImageBitmap;
        const ownedBitmaps = new Set<ImageBitmap>();
        window.createImageBitmap = (async (...args: any[]) => {
          const created = await (createBitmap as any)(...args);
          ownedBitmaps.add(created);
          return created;
        }) as typeof bitmap;
        const closeBitmap = ImageBitmap.prototype.close;
        ImageBitmap.prototype.close = function () {
          ownedBitmaps.delete(this);
          closeBitmap.call(this);
        };
        const result = await h.renderCardImage(src, 5, false, 200, {
          type: "image/png",
        });
        const rendered = await bitmap(result.blob);
        const c = document.createElement("canvas");
        c.width = rendered.width;
        c.height = rendered.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(rendered, 0, 0);
        rendered.close();
        const a = reference
            .getContext("2d")
            .getImageData(0, 0, c.width, c.height).data,
          b = ctx.getImageData(0, 0, c.width, c.height).data;
        let changed = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
        const dimensions = [c.width, c.height];
        c.width = c.height = reference.width = reference.height = 0;
        return {
          fetches,
          changed,
          dimensions,
          report: result.report.kind,
          liveBitmaps: ownedBitmaps.size,
          log: (window as any).workerLog,
        };
      },
      { src, failure }
    );
    expect(result.fetches).toBe(1);
    expect(result.changed).toBe(0);
    expect(result.dimensions).toEqual([574, 771]);
    expect(result.report).toBe("auto");
    expect(result.liveBitmaps).toBe(0);
    expect(result.log.starts).toBe(
      failure === "constructor" ||
        failure === "canvas bitmap" ||
        failure === "source bands"
        ? 0
        : 1
    );
    expect(result.log.stops).toBe(result.log.starts);
  });
}

for (const failure of ["error", "timeout"] as const) {
  test(`a worker ${failure} discards its state and the next request succeeds`, async ({
    page,
  }) => {
    let inject = true;
    await page.route("**/bleed-worker-harness/**", (route) => {
      const file = new URL(route.request().url()).pathname.replace(
        "/bleed-worker-harness/",
        ""
      );
      if (!file.includes("cardRender.worker") || !inject)
        return route.fallback();
      const prefix =
        failure === "error"
          ? 'self.addEventListener("message", e => { e.stopImmediatePropagation(); self.postMessage({id:e.data.id,kind:"error",message:"Injected render error"}); });\n'
          : 'self.addEventListener("message", e => { e.stopImmediatePropagation(); });\n';
      const source = assets.get(file)!;
      return route.fulfill({
        body:
          prefix +
          (typeof source === "string"
            ? source
            : Buffer.from(source).toString("utf8")),
        contentType: "application/javascript",
      });
    });
    const src =
      "data:image/png;base64," +
      (
        await readFile(new URL("./fixtures/arasta.png", import.meta.url))
      ).toString("base64");
    const failed = await page.evaluate(
      async ({ src, failure }) => {
        const nativeTimeout = window.setTimeout;
        if (failure === "timeout")
          window.setTimeout = ((
            callback: TimerHandler,
            delay?: number,
            ...args: any[]
          ) =>
            nativeTimeout(
              callback,
              delay === 60000 ? 20 : delay,
              ...args
            )) as typeof setTimeout;
        let message = "";
        try {
          await (window as any).BleedHarness.renderCardImage(
            src,
            5,
            false,
            200
          );
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        } finally {
          window.setTimeout = nativeTimeout;
        }
        return { message, stops: (window as any).workerLog.stops };
      },
      { src, failure }
    );
    expect(failed.message).toContain(
      failure === "error" ? "Injected render error" : "timed out"
    );
    expect(failed.stops).toBe(1);
    inject = false;
    const recovered = await page.evaluate(async (src) => {
      const result = await (window as any).BleedHarness.renderCardImage(
        src,
        2,
        false,
        200
      );
      const bitmap = await createImageBitmap(result.blob);
      const dimensions = [bitmap.width, bitmap.height];
      bitmap.close();
      return { dimensions, log: (window as any).workerLog };
    }, src);
    expect(recovered.dimensions).toEqual([528, 725]);
    expect(recovered.log.starts).toBe(2);
    expect(recovered.log.stops).toBe(1);
  });
}

test("invalid original images fail once and leave the shared queue usable", async ({
  page,
}) => {
  const src =
    "data:image/png;base64," +
    (
      await readFile(new URL("./fixtures/arasta.png", import.meta.url))
    ).toString("base64");
  const result = await page.evaluate(async (src) => {
    const fetch = window.fetch;
    let fetches = 0;
    window.fetch = (...args) => {
      fetches++;
      return fetch(...args);
    };
    let failed = false;
    try {
      await (window as any).BleedHarness.renderCardImage(
        "data:image/png;base64,bm90LWFuLWltYWdl",
        5,
        false,
        200
      );
    } catch {
      failed = true;
    }
    const afterFailure = { fetches, starts: (window as any).workerLog.starts };
    const result = await (window as any).BleedHarness.renderCardImage(
      src,
      5,
      false,
      200
    );
    return { failed, afterFailure, fetches, kind: result.report.kind };
  }, src);
  expect(result.failed).toBe(true);
  expect(result.afterFailure).toEqual({ fetches: 1, starts: 0 });
  expect(result.fetches).toBe(2);
  expect(result.kind).toBe("auto");
});

test("an idle worker is released and recreated when work resumes", async ({
  page,
}) => {
  await page.clock.install();
  const src =
    "data:image/png;base64," +
    (
      await readFile(new URL("./fixtures/arasta.png", import.meta.url))
    ).toString("base64");
  await page.evaluate(
    (src) =>
      (window as any).BleedHarness.renderCardImage(src, 2, false, 200).then(
        () => null
      ),
    src
  );
  const before = await page.evaluate(() => (window as any).workerLog);
  expect(before.starts).toBe(1);
  expect(before.stops).toBe(0);
  await page.clock.fastForward(30001);
  expect(await page.evaluate(() => (window as any).workerLog.stops)).toBe(1);
  await page.evaluate(
    (src) =>
      (window as any).BleedHarness.renderCardImage(src, 2, false, 200).then(
        () => null
      ),
    src
  );
  const after = await page.evaluate(() => (window as any).workerLog);
  expect(after.starts).toBe(2);
  expect(after.stops).toBe(1);
});

test("a reused worker releases per-request bitmaps and canvas backing before replying", async ({
  page,
}) => {
  await page.route("**/bleed-worker-harness/**", (route) => {
    const file = new URL(route.request().url()).pathname.replace(
      "/bleed-worker-harness/",
      ""
    );
    if (!file.includes("cardRender.worker")) return route.fallback();
    const source = assets.get(file)!;
    const instrument = `
      const ownedBitmaps = new Set(), ownedCanvases = new Set();
      let closedBitmaps = 0, sourceDecodes = 0;
      self.addEventListener("message", event => {
        ownedBitmaps.add(event.data.source.interior);
        for (const band of event.data.source.bands) ownedBitmaps.add(band.bitmap);
      });
      self.createImageBitmap = async () => {
        sourceDecodes++;
        throw new Error("The worker must never decode another source image");
      };
      const nativeClose = ImageBitmap.prototype.close;
      ImageBitmap.prototype.close = function () {
        if (ownedBitmaps.delete(this)) closedBitmaps++;
        return nativeClose.call(this);
      };
      const NativeCanvas = OffscreenCanvas;
      self.OffscreenCanvas = class extends NativeCanvas {
        constructor(...args) { super(...args); ownedCanvases.add(this); }
      };
      const nativePost = self.postMessage.bind(self);
      self.postMessage = (data, ...args) => {
        data.resources = {
          bitmaps: ownedBitmaps.size,
          canvasPixels: [...ownedCanvases].reduce((sum, canvas) => sum + canvas.width * canvas.height, 0),
          closedBitmaps,
          sourceDecodes,
        };
        return nativePost(data, ...args);
      };
    `;
    return route.fulfill({
      body:
        instrument +
        (typeof source === "string"
          ? source
          : Buffer.from(source).toString("utf8")),
      contentType: "application/javascript",
    });
  });
  const src =
    "data:image/png;base64," +
    (
      await readFile(new URL("./fixtures/arasta.png", import.meta.url))
    ).toString("base64");
  const mpcSrc =
    "data:image/png;base64," +
    (
      await readFile(
        new URL("./fixtures/mpc-simple-lotus.png", import.meta.url)
      )
    ).toString("base64");
  const result = await page.evaluate(
    async ({ src, mpcSrc }) => {
      const h = (window as any).BleedHarness;
      let sourceDecodes = 0;
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        sourceDecodes++;
        return decode.call(this);
      };
      const urls = new Set<string>();
      const createUrl = URL.createObjectURL,
        revokeUrl = URL.revokeObjectURL;
      URL.createObjectURL = (blob) => {
        const url = createUrl(blob);
        urls.add(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        urls.delete(url);
        revokeUrl(url);
      };
      const liveUrlsAtDispatch: number[] = [],
        bandCounts: number[] = [];
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (...args: any[]) {
        liveUrlsAtDispatch.push(urls.size);
        bandCounts.push(args[0].source.bands.length);
        return (post as any).apply(this, args);
      };
      const first = await h.renderCardImage(src, 2, false, 200);
      const second = await h.renderCardImage(src, 5, false, 1200);
      const supplied = await h.renderCardImage(mpcSrc, 3, true, 200);
      const square = await h.renderCardImage(src, 5, false, 200, {
        artwork: { source: "square", insetMm: 0, borders: "mirror" },
      });
      return {
        first: first.resources,
        second: second.resources,
        supplied: supplied.resources,
        square: square.resources,
        sourceDecodes,
        liveUrlsAtDispatch,
        bandCounts,
        log: (window as any).workerLog,
      };
    },
    { src, mpcSrc }
  );
  expect(result.first).toEqual({
    bitmaps: 0,
    canvasPixels: 0,
    closedBitmaps: 5,
    sourceDecodes: 0,
  });
  expect(result.second).toEqual({
    bitmaps: 0,
    canvasPixels: 0,
    closedBitmaps: 10,
    sourceDecodes: 0,
  });
  expect(result.supplied).toEqual({
    bitmaps: 0,
    canvasPixels: 0,
    closedBitmaps: 11,
    sourceDecodes: 0,
  });
  expect(result.square).toEqual({
    bitmaps: 0,
    canvasPixels: 0,
    closedBitmaps: 12,
    sourceDecodes: 0,
  });
  expect(result.sourceDecodes).toBe(4);
  expect(result.liveUrlsAtDispatch).toEqual([0, 0, 0, 0]);
  expect(result.bandCounts).toEqual([4, 4, 0, 0]);
  expect(result.log.starts).toBe(1);
  expect(result.log.stops).toBe(0);
});

test("SVG sources use bounded native band rasters without image-crop support", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const src =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="630" height="880"><rect width="630" height="880" fill="#b7cf7a"/><circle cx="315" cy="440" r="300" fill="#346c93"/></svg>'
      );
    const h = (window as any).BleedHarness;
    const reference = await h.renderCardCanvas(src, 5, false, 200);
    const createBitmap = window.createImageBitmap;
    let crops = 0,
      canvasBitmaps = 0,
      sourceDecodes = 0,
      maxCanvasArea = 0;
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      sourceDecodes++;
      return decode.call(this);
    };
    window.createImageBitmap = ((...args: any[]) => {
      if (args[0] instanceof HTMLImageElement) {
        crops++;
        return Promise.reject(
          new DOMException("Image crop unsupported", "NotSupportedError")
        );
      }
      if (args[0] instanceof HTMLCanvasElement) {
        canvasBitmaps++;
        maxCanvasArea = Math.max(maxCanvasArea, args[0].width * args[0].height);
      }
      return (createBitmap as any)(...args);
    }) as typeof createBitmap;
    const result = await h.renderCardImage(src, 5, false, 200, {
      type: "image/png",
    });
    const bitmap = await createBitmap(result.blob);
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const a = reference
      .getContext("2d")
      .getImageData(0, 0, c.width, c.height).data;
    const b = ctx.getImageData(0, 0, c.width, c.height).data;
    let changed = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
    c.width = c.height = reference.width = reference.height = 0;
    return {
      crops,
      canvasBitmaps,
      sourceDecodes,
      maxCanvasArea,
      changed,
      log: (window as any).workerLog,
    };
  });
  expect(result.crops).toBe(0);
  expect(result.canvasBitmaps).toBe(5);
  expect(result.sourceDecodes).toBe(1);
  expect(result.maxCanvasArea).toBeLessThan(630 * 880);
  expect(result.changed).toBe(0);
  expect(result.log.starts).toBe(1);
  expect(result.log.stops).toBe(0);
  expect(result.log.messages).toEqual(["done"]);
});

test("a 50-megapixel source transfers bounded perimeter bands without another source decode", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const input = document.createElement("canvas");
    input.width = 6000;
    input.height = 8381;
    const ctx = input.getContext("2d")!;
    ctx.fillStyle = "#5296b3";
    ctx.fillRect(0, 0, input.width, input.height);
    const blob = await new Promise<Blob>((resolve) =>
      input.toBlob((value) => resolve(value!))
    );
    input.width = input.height = 0;
    const src = URL.createObjectURL(blob);
    let sourceDecodes = 0,
      maxCanvasArea = 0;
    const canvases = new Set<HTMLCanvasElement>();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args: any[]) {
      maxCanvasArea = Math.max(maxCanvasArea, this.width * this.height);
      canvases.add(this);
      return (getContext as any).apply(this, args);
    } as typeof getContext;
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      sourceDecodes++;
      return decode.call(this);
    };
    let transport:
      | {
          nativeArea: number;
          maxBandArea: number;
          totalBandArea: number;
          count: number;
          hasBlob: boolean;
        }
      | undefined;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args: any[]) {
      const message = args[0],
        source = message.source;
      const areas = source.bands.map(
        (band: any) => band.bitmap.width * band.bitmap.height
      );
      transport = {
        nativeArea: source.width * source.height,
        maxBandArea: Math.max(...areas),
        totalBandArea: areas.reduce(
          (sum: number, area: number) => sum + area,
          0
        ),
        count: args[1].length,
        hasBlob: "blob" in message,
      };
      return (post as any).apply(this, args);
    };
    try {
      const result = await (window as any).BleedHarness.renderCardImage(
        src,
        5,
        false,
        1200
      );
      return {
        sourceDecodes,
        maxCanvasArea,
        released: [...canvases].every(
          (canvas) => canvas.width === 0 && canvas.height === 0
        ),
        transport,
        kind: result.report.kind,
      };
    } finally {
      URL.revokeObjectURL(src);
    }
  });
  expect(result.sourceDecodes).toBe(1);
  expect(result.maxCanvasArea).toBeLessThanOrEqual(16_777_216);
  expect(result.released).toBe(true);
  expect(result.transport!.nativeArea).toBe(6000 * 8381);
  expect(result.transport!.maxBandArea).toBeLessThan(
    result.transport!.nativeArea / 10
  );
  expect(result.transport!.totalBandArea).toBeLessThan(
    result.transport!.nativeArea / 3
  );
  expect(result.transport!.count).toBe(5);
  expect(result.transport!.hasBlob).toBe(false);
  expect(result.kind).toBe("auto");
});
