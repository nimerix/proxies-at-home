const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const axios = require("axios");
const Bottleneck = require("bottleneck");
const cacheDir = path.resolve(
  process.env.IMAGE_CACHE_DIR || path.join(__dirname, "..", "cached-images")
);
const MAX_BYTES = 30 * 1024 * 1024;
const CACHE_BYTES = 512 * 1024 * 1024;
const TTL = 7 * 86400 * 1000;
const inFlight = new Map();
const downloads = new Bottleneck({
  maxConcurrent: 4,
  highWater: 40,
  strategy: Bottleneck.strategy.OVERFLOW,
});
const CDN_HOSTS = new Set([
  "cards.scryfall.io",
  "c1.scryfall.com",
  "img.scryfall.com",
]);
function allowedImageUrl(raw, drive = false) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const google =
    host === "drive.google.com" ||
    host === "drive.usercontent.google.com" ||
    host === "lh3.googleusercontent.com" ||
    host.endsWith(".googleusercontent.com");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !(drive ? google : CDN_HOSTS.has(host))
  )
    throw new Error("Image URL is not an allowed source.");
  return url.toString();
}
async function downloadImage(raw, drive = false) {
  let url = allowedImageUrl(raw, drive);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await axios.get(url, {
      timeout: 15000,
      signal: AbortSignal.timeout(20000),
      responseType: "arraybuffer",
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: {
        "User-Agent": "OopsAllProxies/1.0 (https://www.oopsallproxies.com)",
        Accept: "image/png,image/jpeg,image/webp,image/avif,image/gif",
      },
    });
    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.location
    ) {
      url = allowedImageUrl(
        new URL(response.headers.location, url).toString(),
        drive
      );
      continue;
    }
    const type = String(response.headers["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (
      response.status !== 200 ||
      ![
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/avif",
        "image/gif",
      ].includes(type) ||
      !response.data.length
    )
      throw new Error(
        "The source did not return a supported image. Check that it is publicly accessible."
      );
    return { data: response.data, type };
  }
  throw new Error("Too many image redirects.");
}
let pruning = Promise.resolve();
function pruneCache() {
  pruning = pruning
    .then(async () => {
      const entries = await fs.readdir(cacheDir, { withFileTypes: true });
      const files = [];
      for (const entry of entries)
        if (entry.isFile() && entry.name.endsWith(".image")) {
          try {
            const filename = path.join(cacheDir, entry.name);
            const stat = await fs.stat(filename);
            files.push({ filename, size: stat.size, time: stat.mtimeMs });
          } catch {
            /* Another eviction may have removed it. */
          }
        }
      files.sort((a, b) => b.time - a.time);
      let total = 0;
      for (const file of files) {
        total += file.size;
        if (Date.now() - file.time > TTL || total > CACHE_BYTES)
          await fs.unlink(file.filename).catch(() => {});
      }
    })
    .catch(() => {});
  return pruning;
}
async function cachedImage(key, load) {
  const filename = path.join(
    cacheDir,
    crypto.createHash("sha256").update(key).digest("hex") + ".image"
  );
  await fs.mkdir(cacheDir, { recursive: true });
  try {
    const stat = await fs.stat(filename);
    if (Date.now() - stat.mtimeMs < TTL) {
      const packed = await fs.readFile(filename);
      const split = packed.indexOf(10);
      if (split > 0)
        return {
          type: packed.subarray(0, split).toString(),
          data: packed.subarray(split + 1),
        };
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (inFlight.has(key)) return inFlight.get(key);
  const task = downloads.schedule(async () => {
    const result = await load();
    const temp = `${filename}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(
        temp,
        Buffer.concat([
          Buffer.from(result.type + "\n"),
          Buffer.from(result.data),
        ])
      );
      await fs.rename(temp, filename);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
    await pruneCache();
    return result;
  });
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}
module.exports = { allowedImageUrl, downloadImage, cachedImage };
