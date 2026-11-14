const express = require("express");
const {
  getImagesForCardInfo,
  fetchCardsByQuery,
  SCRYFALL_HOST,
  quoted,
} = require("../utils/getCardImagesPaged");
const { scryfallGet } = require("../utils/http");
const {
  allowedImageUrl,
  downloadImage,
  cachedImage,
} = require("../utils/imageCache");
const imageRouter = express.Router();
const languages = new Set([
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ja",
  "ko",
  "ru",
  "zhs",
  "zht",
]);
let activeImports = 0;
function validateQueries(body) {
  if (!body || typeof body !== "object")
    throw new Error("Provide cardQueries or cardNames.");
  if (body.language != null && typeof body.language !== "string")
    throw new Error("Invalid card language.");
  const unique = body.cardArt ?? "art";
  const language =
    typeof body.language === "string" ? body.language.toLowerCase() : "en";
  if (!["art", "prints"].includes(unique) || !languages.has(language))
    throw new Error("Invalid artwork mode or language.");
  const raw = Array.isArray(body.cardQueries)
    ? body.cardQueries
    : Array.isArray(body.cardNames)
      ? body.cardNames.map((name) => ({ name }))
      : null;
  if (!raw?.length || raw.length > (unique === "prints" ? 5 : 100))
    throw new Error(
      "Provide 1–100 card queries, or up to 5 names for all printings."
    );
  const infos = raw.map((q) => {
    if (
      !q ||
      typeof q.name !== "string" ||
      !q.name.trim() ||
      q.name.length > 200 ||
      (q.set != null &&
        (typeof q.set !== "string" || !/^[a-z0-9]{2,8}$/i.test(q.set))) ||
      (q.number != null &&
        (typeof q.number !== "string" || q.number.length > 30))
    )
      throw new Error(
        "Each card needs a valid name, optional set code and collector number."
      );
    const lang =
      q.language == null
        ? language
        : typeof q.language === "string"
          ? q.language.toLowerCase()
          : "";
    if (!languages.has(lang)) throw new Error("Invalid card language.");
    return {
      name: q.name.trim(),
      set: q.set?.toLowerCase(),
      number: q.number,
      language: lang,
    };
  });
  return { infos, unique, fallback: body.fallbackToEnglish !== false };
}
imageRouter.post("/", async (req, res) => {
  let input;
  try {
    input = validateQueries(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (activeImports >= 8)
    return res
      .status(503)
      .json({ error: "The card service is busy. Try again shortly." });
  activeImports++;
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(175000),
  ]);
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const results = [];
    for (const info of input.infos) {
      signal.throwIfAborted();
      let cards;
      if (input.unique === "prints") {
        cards = await fetchCardsByQuery(
          `!${quoted(info.name)} include:extras game:paper unique:prints lang:${info.language}`,
          signal
        );
        if (!cards.length && input.fallback && info.language !== "en")
          cards = await fetchCardsByQuery(
            `!${quoted(info.name)} include:extras game:paper unique:prints lang:en`,
            signal
          );
      } else
        cards = [
          await getImagesForCardInfo(
            info,
            "art",
            info.language,
            input.fallback,
            signal
          ),
        ];
      results.push(
        ...cards.map((card) => ({
          ...card,
          name: card.name || info.name,
          number: card.collector_number || info.number,
          language: info.language,
          query: info,
        }))
      );
    }
    return res.json(results);
  } catch (error) {
    if (!res.destroyed)
      return res
        .status(502)
        .json({
          error: signal.aborted
            ? "Card lookup timed out. Try a smaller list."
            : error.message,
        });
  } finally {
    activeImports--;
  }
});
function sendImage(res, image) {
  res.set({
    "Content-Type": image.type,
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  return res.send(image.data);
}
imageRouter.get("/proxy", async (req, res) => {
  let url;
  try {
    if (typeof req.query.url !== "string") throw new Error();
    url = allowedImageUrl(req.query.url);
  } catch {
    return res
      .status(400)
      .json({ error: "Use a supported Scryfall HTTPS image URL." });
  }
  try {
    return sendImage(res, await cachedImage(url, () => downloadImage(url)));
  } catch {
    return res
      .status(502)
      .json({
        error: "Could not download the image. Retry or choose another artwork.",
      });
  }
});
imageRouter.get("/front", async (req, res) => {
  const id = req.query.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{12,200}$/.test(id))
    return res.status(400).json({ error: "Invalid Google Drive image ID." });
  try {
    const url = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
    return sendImage(
      res,
      await cachedImage(`drive:${id}`, () => downloadImage(url, true))
    );
  } catch {
    return res
      .status(502)
      .json({
        error:
          "Could not fetch this Drive image. It must be shared publicly and be under 30 MB.",
      });
  }
});
imageRouter.get("/autocomplete", async (req, res) => {
  const q = req.query.q;
  if (typeof q !== "string" || q.length > 200)
    return res
      .status(400)
      .json({ error: "Enter a card name under 200 characters." });
  if (q.trim().length < 2) return res.json({ data: [] });
  try {
    return res.json(
      (await scryfallGet(
        `${SCRYFALL_HOST}/cards/autocomplete?q=${encodeURIComponent(q.trim())}`,
        AbortSignal.timeout(12000)
      )) || { data: [] }
    );
  } catch {
    return res
      .status(502)
      .json({
        error: "Suggestions are unavailable. You can still search by name.",
      });
  }
});
let setsCache;
imageRouter.get("/sets", async (_req, res) => {
  try {
    if (!setsCache || setsCache.expires < Date.now())
      setsCache = {
        data: await scryfallGet(
          `${SCRYFALL_HOST}/sets`,
          AbortSignal.timeout(20000)
        ),
        expires: Date.now() + 86400000,
      };
    return res.json(setsCache.data);
  } catch {
    return res
      .status(502)
      .json({
        error: "Set names are unavailable. Filter by set code instead.",
      });
  }
});
imageRouter.get("/diag", (_req, res) => res.json({ ok: true }));
module.exports = { imageRouter, validateQueries };
