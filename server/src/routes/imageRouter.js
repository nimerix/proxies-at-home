const express = require("express");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const multer = require("multer");
const upload = multer({ dest: path.join(__dirname, "../uploaded-images") });
const { getScryfallPngImagesForCard } = require("../utils/getCardImagesPaged");

const imageRouter = express.Router();

const cacheDir = path.join(__dirname, "..", "cached-images");
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir);
}

imageRouter.post("/", async (req, res) => {
  const cardNames = req.body.cardNames;
  if (!Array.isArray(cardNames)) {
    return res.status(400).json({ error: "cardNames must be an array of strings" });
  }

  const results = await Promise.all(
    cardNames.map(async (name) => {
      const imageUrls = await getScryfallPngImagesForCard(name);
      return { name, imageUrls };
    })
  );

  return res.json(results);
});

imageRouter.get("/proxy", async (req, res) => {
  const url = req.query.url;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing or invalid ?url" });
  }

  try {
    const imageUrl = decodeURIComponent(url);
    const fileName = path.basename(imageUrl.split("?")[0]);
    const localPath = path.join(cacheDir, fileName);

    if (fs.existsSync(localPath)) {
      return res.sendFile(localPath);
    }

    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    fs.writeFileSync(localPath, response.data);
    return res.sendFile(localPath);
  } catch (err) {
    console.error("Failed to proxy image:", err.message);
    return res.status(500).json({ error: "Failed to download image" });
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
    uploaded: req.files.map(file => ({
      name: file.originalname,
      path: file.filename
    }))
  });
});

module.exports = { imageRouter };
