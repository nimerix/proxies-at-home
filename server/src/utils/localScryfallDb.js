const fs = require("fs");
const path = require("path");
const StreamArray = require("stream-json/streamers/StreamArray");

let cachedDb = null;
let cachedDbPath = null;
let loadingPromise = null;

/**
 * Find the most recent all-cards-*.json file in the cache directory
 */
function findMostRecentDbFile() {
  const cacheDir = path.join(__dirname, "..", "..", "cache");

  if (!fs.existsSync(cacheDir)) {
    return null;
  }

  const files = fs.readdirSync(cacheDir);
  const dbFiles = files
    .filter(f => f.startsWith("all-cards-") && f.endsWith(".json"))
    .map(f => ({
      name: f,
      path: path.join(cacheDir, f),
      timestamp: f.match(/all-cards-(\d+)\.json/)?.[1] || "0"
    }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return dbFiles.length > 0 ? dbFiles[0].path : null;
}

/**
 * Load the local Scryfall database into memory using streaming
 */
async function loadLocalDb() {
  const dbPath = findMostRecentDbFile();

  if (!dbPath) {
    console.warn("[LocalDB] No all-cards-*.json file found in cache directory");
    return null;
  }

  // If we already loaded this file, return cached version
  if (cachedDb && cachedDbPath === dbPath) {
    return cachedDb;
  }

  // If we're already loading, wait for that to complete
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = new Promise((resolve, reject) => {
    console.log(`[LocalDB] Loading database from ${path.basename(dbPath)}...`);
    const startTime = Date.now();
    const cards = [];

    const stream = fs.createReadStream(dbPath);
    const jsonStream = StreamArray.withParser();

    stream.pipe(jsonStream);

    jsonStream.on('data', ({ value }) => {
      cards.push(value);
    });

    jsonStream.on('end', () => {
      cachedDb = cards;
      cachedDbPath = dbPath;
      loadingPromise = null;
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[LocalDB] Loaded ${cachedDb.length} cards in ${duration}s`);
      resolve(cachedDb);
    });

    jsonStream.on('error', (err) => {
      console.error(`[LocalDB] Failed to load database:`, err.message);
      cachedDb = null;
      cachedDbPath = null;
      loadingPromise = null;
      reject(err);
    });

    stream.on('error', (err) => {
      console.error(`[LocalDB] Failed to read file:`, err.message);
      loadingPromise = null;
      reject(err);
    });
  });

  return loadingPromise;
}

/**
 * Search local database for cards matching a query
 * Supports basic Scryfall query syntax: set:, number:, name:, lang:, unique:
 */
async function searchLocalDb(query) {
  const db = await loadLocalDb();
  if (!db) return [];

  // Parse query string
  const params = {
    name: null,
    set: null,
    number: null,
    lang: "en",
    unique: "art"
  };

  // Extract set: filter
  const setMatch = query.match(/set:(\S+)/i);
  if (setMatch) params.set = setMatch[1].toLowerCase();

  // Extract number: filter
  const numberMatch = query.match(/number:(\S+)/i);
  if (numberMatch) params.number = numberMatch[1].replace(/\\:/g, ":");

  // Extract name: filter (quoted or exact match with !)
  let nameMatch = query.match(/name:"([^"]+)"/i);
  if (nameMatch) {
    params.name = nameMatch[1];
  } else {
    nameMatch = query.match(/!"([^"]+)"/);
    if (nameMatch) params.name = nameMatch[1];
  }

  // Extract lang: filter
  const langMatch = query.match(/lang:(\w+)/i);
  if (langMatch) params.lang = langMatch[1].toLowerCase();

  // Extract unique: filter
  const uniqueMatch = query.match(/unique:(art|prints)/i);
  if (uniqueMatch) params.unique = uniqueMatch[1].toLowerCase();

  if (!params.name) {
    console.warn("[LocalDB] No name found in query:", query);
    return [];
  }

  // Filter cards
  let results = db.filter(card => {
    // Name match (case-insensitive exact match)
    if (params.name && card.name.toLowerCase() !== params.name.toLowerCase()) {
      return false;
    }

    // Set match
    if (params.set && card.set.toLowerCase() !== params.set.toLowerCase()) {
      return false;
    }

    // Collector number match
    if (params.number && card.collector_number !== params.number) {
      return false;
    }

    // Language match
    if (params.lang && card.lang !== params.lang) {
      return false;
    }

    return true;
  });

  // Handle unique:art vs unique:prints
  if (params.unique === "art") {
    // Group by illustration_id and take one from each group
    const seenArt = new Set();
    results = results.filter(card => {
      const artId = card.illustration_id;
      if (!artId || seenArt.has(artId)) return false;
      seenArt.add(artId);
      return true;
    });
  }
  // unique:prints returns all results (no deduplication)

  return results;
}

/**
 * Extract PNG image URLs from cards, handling DFC
 */
function extractPngUrls(cards) {
  const pngs = [];

  for (const card of cards) {
    if (card?.image_uris?.png) {
      pngs.push(card.image_uris.png);
    } else if (Array.isArray(card?.card_faces)) {
      for (const face of card.card_faces) {
        if (face?.image_uris?.png) {
          pngs.push(face.image_uris.png);
        }
      }
    }
  }

  return pngs;
}

/**
 * Query the local database and return PNG URLs
 */
async function queryLocalDbForPngs(query) {
  const cards = await searchLocalDb(query);
  return extractPngUrls(cards);
}

module.exports = {
  loadLocalDb,
  searchLocalDb,
  queryLocalDbForPngs,
  findMostRecentDbFile
};
