const axios = require("axios");
const Bottleneck = require("bottleneck");
const { setTimeout: delay } = require("node:timers/promises");
const limiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 120,
  highWater: 200,
  strategy: Bottleneck.strategy.OVERFLOW,
});
const api = axios.create({
  timeout: 15000,
  maxRedirects: 0,
  maxContentLength: 12 * 1024 * 1024,
  headers: {
    "User-Agent": "Proxxied/1.0 (https://github.com/kclipsto/proxies-at-home)",
    Accept: "application/json",
  },
  validateStatus: () => true,
});
async function scryfallGet(url, signal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    const response = await limiter.schedule(async () => {
      signal?.throwIfAborted();
      return api.get(url, { signal });
    });
    if (response.status === 404) return null;
    if (response.status >= 200 && response.status < 300) return response.data;
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const seconds = Math.min(
        10,
        Math.max(1, Number(response.headers["retry-after"]) || 2 ** attempt)
      );
      await delay(seconds * 1000, undefined, { signal });
      continue;
    }
    throw new Error(
      `Card service returned HTTP ${response.status}. Please retry shortly.`
    );
  }
  throw new Error("Card service is busy. Please retry shortly.");
}
module.exports = { scryfallGet };
