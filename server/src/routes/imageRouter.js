const express = require("express");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const multer = require("multer");
const { getScryfallPngImagesForCard,
  getImagesForCardInfo,
  getScryfallPngImagesForCardPrints } = require("../utils/getCardImagesPaged");
const crypto = require("crypto");

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

imageRouter.post("/", async (req, res) => {
  const cardQueries = Array.isArray(req.body.cardQueries) ? req.body.cardQueries : null;
  const cardNames = Array.isArray(req.body.cardNames) ? req.body.cardNames : null;
  const unique = (req.body.cardArt || "art");
  if (!cardQueries && !cardNames) {
    return res.status(400).json({ error: "Provide cardQueries (preferred) or cardNames." });
  }

  const infos = cardQueries
    ? cardQueries.map((q) => ({ name: q.name, set: q.set, number: q.number }))
    : cardNames.map((name) => ({ name }));

  try {
    const results = await Promise.all(
      infos.map(async (ci) => {
        const imageUrls = await getImagesForCardInfo(ci, unique);
        return { name: ci.name, set: ci.set, number: ci.number, imageUrls };
      })
    );
    return res.json(results);
  } catch (err) {
    console.error("Fetch error:", err?.message);
    return res.status(500).json({ error: "Failed to fetch images from Scryfall." });
  }
});


imageRouter.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing or invalid ?url" });
  }

  const originalUrl = (() => {
    try { return decodeURIComponent(url); } catch { return url; }
  })();

  try {
    const localPath = cachePathFromUrl(originalUrl);

    if (fs.existsSync(localPath)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.sendFile(localPath);
    }

    const response = await axios.get(originalUrl, { responseType: "arraybuffer" });
    fs.writeFileSync(localPath, response.data);

    const contentType =
      response.headers["content-type"]?.startsWith?.("image/")
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
      from: originalUrl
    });
  }
});

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

module.exports = { imageRouter };
