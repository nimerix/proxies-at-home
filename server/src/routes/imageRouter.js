const express = require("express");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const multer = require("multer");
const crypto = require("crypto");

const {
  getScryfallPngImagesForCard,
  getImagesForCardInfo,
  getScryfallPngImagesForCardPrints,
} = require("../utils/getCardImagesPaged");

// -------------------- cache helpers --------------------

const imageRouter = express.Router();

const cacheDir = path.join(__dirname, "..", "cached-images");
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir);
}

const uploadDir = path.join(__dirname, "..", "uploaded-images");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

// Make a stable cache filename from the FULL raw URL (path + query)
function cachePathFromUrl(originalUrl) {
  const hash = crypto.createHash("sha1").update(originalUrl).digest("hex");

  // try to preserve the real extension; default to .png
  let ext = ".png";
  try {
    const u = new URL(originalUrl);
    const m = u.pathname.match(/\.(png|jpg|jpeg|webp)$/i);
    if (m) ext = m[0].toLowerCase();
  } catch {
    // ignore; keep .png
  }
  return path.join(cacheDir, `${hash}${ext}`);
}

// -------------------- API: fetch images for cards --------------------

imageRouter.post("/", async (req, res) => {
  const cardQueries = Array.isArray(req.body.cardQueries)
    ? req.body.cardQueries
    : null;
  const cardNames = Array.isArray(req.body.cardNames)
    ? req.body.cardNames
    : null;

  const unique = req.body.cardArt || "art";
  // NEW: language & fallback (optional)
  const language = (req.body.language || "en").toLowerCase(); // NEW
  const fallbackToEnglish =
    typeof req.body.fallbackToEnglish === "boolean"
      ? req.body.fallbackToEnglish
      : true; // NEW

  if (!cardQueries && !cardNames) {
    return res
      .status(400)
      .json({ error: "Provide cardQueries (preferred) or cardNames." });
  }

  const infos = cardQueries
    ? cardQueries.map((q) => ({
        name: q.name,
        set: q.set,
        number: q.number,
        // allow per-card language override if provided
        language: (q.language || language || "en").toLowerCase(), // NEW
      }))
    : cardNames.map((name) => ({ name, language })); // NEW

  try {
    const results = await Promise.all(
      infos.map(async (ci) => {
        const imageUrls = await getImagesForCardInfo(
          ci,
          unique,
          ci.language, // NEW
          fallbackToEnglish // NEW
        );
        return {
          name: ci.name,
          set: ci.set,
          number: ci.number,
          imageUrls,
          language: ci.language, // NEW: echo which lang was used
        };
      })
    );

    return res.json(results);
  } catch (err) {
    console.error("Fetch error:", err?.message);
    return res
      .status(500)
      .json({ error: "Failed to fetch images from Scryfall." });
  }
});

// -------------------- proxy (cached) --------------------

imageRouter.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing or invalid ?url" });
  }

  const originalUrl = (() => {
    try {
      return decodeURIComponent(url);
    } catch {
      return url;
    }
  })();

  try {
    const localPath = cachePathFromUrl(originalUrl);

    if (fs.existsSync(localPath)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.sendFile(localPath);
    }

    const response = await axios.get(originalUrl, {
      responseType: "arraybuffer",
    });
    fs.writeFileSync(localPath, response.data);

    const contentType = response.headers["content-type"]?.startsWith?.("image/")
      ? response.headers["content-type"]
      : "image/png";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.sendFile(localPath);
  } catch (err) {
    const status = err.response?.status;
    console.error("Proxy error:", {
      message: err.message,
      status,
      from: originalUrl,
    });
    return res.status(502).json({
      error: "Failed to download image",
      status,
      from: originalUrl,
    });
  }
});

// -------------------- maintenance & uploads --------------------

imageRouter.delete("/", (req, res) => {
  fs.readdir(cacheDir, (err, files) => {
    if (err) {
      console.error("Error reading cache directory:", err.message);
      return res.status(500).json({ error: "Failed to read cache directory" });
    }

    for (const file of files) {
      const filePath = path.join(cacheDir, file);
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          console.warn(`Failed to delete ${filePath}:`, unlinkErr.message);
        }
      });
    }

    return res.json({ message: "Cached images cleared." });
  });
});

imageRouter.post("/upload", upload.array("images"), (req, res) => {
  return res.json({
    uploaded: req.files.map((file) => ({
      name: file.originalname,
      path: file.filename,
    })),
  });
});

// -------------------- Google Drive helper --------------------

imageRouter.get("/front", async (req, res) => {
  const id = String(req.query.id || "").trim();
  if (!id) return res.status(400).send("Missing id");

  // Try a couple of GDrive URL shapes; only accept image/* responses
  const candidates = [
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
    `https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`,
    `https://drive.google.com/open?id=${encodeURIComponent(id)}`,
  ];

  for (const url of candidates) {
    try {
      const r = await axios.get(url, {
        responseType: "stream",
        maxRedirects: 5,
        headers: { "User-Agent": "Mozilla/5.0" },
        validateStatus: () => true,
      });

      const ct = (r.headers["content-type"] || "").toLowerCase();
      // Only pipe if GDrive actually gave us an image
      if (!ct.startsWith("image/")) {
        // Not an image (likely HTML interstitial); try next candidate
        continue;
      }

      res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return r.data.pipe(res);
    } catch (_) {
      // try next candidate
    }
  }

  return res.status(502).send("Could not fetch Google Drive image");
});

module.exports = { imageRouter };