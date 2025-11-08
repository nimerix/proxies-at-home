const axios = require("axios");
const { queryLocalDbForPngs } = require("./localScryfallDb");

const SCRYFALL_API = "https://api.scryfall.com/cards/search";

// Use local database instead of API calls
// Set via environment variable: USE_LOCAL_DB=true
const USE_LOCAL_DB = process.env.USE_LOCAL_DB === "true";

// Optional: a polite UA helps if you get rate-limited
const AX = axios.create({
  headers: { "User-Agent": "Proxxied/1.0 (contact: your-email@example.com)" },
  validateStatus: (s) => s >= 200 && s < 500, // surface 4xx/429 to logic
});

if (USE_LOCAL_DB) {
  console.log("[Scryfall] Using local database instead of API");
}

// Retry logic with exponential backoff for 429 / transient errors
async function getWithRetry(url, tries = 5) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await AX.get(url);
      if (res.status === 429) {
        // Respect Retry-After header with longer fallback
        const retryAfter = Number(res.headers["retry-after"] || 0);
        const wait = retryAfter > 0 ? retryAfter : Math.min(60, Math.pow(2, i));
        console.log(`[429] Rate limited on ${url}, waiting ${wait}s before retry ${i + 1}/${tries}`);
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }

      // Client errors (4xx except 429) should NOT be retried (404, etc.)
      if (res.status >= 400 && res.status < 500) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        err.response = res;
        throw err;
      }

      if (res.status >= 200 && res.status < 300) return res;

      // Server errors (5xx) - will be retried
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;

      // Don't retry client errors (4xx except 429)
      // Check both e.status (from our custom throw) and e.response.status (from axios)
      const status = e.status || (e.response && e.response.status);
      if (status >= 400 && status < 500 && status !== 429) {
        throw e;
      }

      // Retry network errors and server errors (5xx) with exponential backoff
      if (i < tries - 1) {
        const backoff = 500 * Math.pow(2, i);
        console.log(`[Retry] Attempt ${i + 1}/${tries} failed for ${url}, waiting ${backoff}ms`);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr;
}

/**
 * Core: given a CardInfo { name, set?, number?, language? }, return card data with metadata.
 * If set && number => try exact printing (that language); else set+name; else name-only.
 * `unique` can be "art" or "prints".
 */
async function getImagesForCardInfo(
  cardInfo,
  unique = "art",
  language = "en",
  fallbackToEnglish = true
) {
  const { name, set, number } = cardInfo || {};
  const lang = (language || "en").toLowerCase();

  // 1) Exact printing: set + collector number + name (language filter still applied)
  if (set && number) {
    const q = `set:${set} number:${escapeColon(
      number
    )} name:"${name}" include:extras unique:prints lang:${lang}`;
    let cards = await fetchCardsByQuery(q);
    if (!cards.length && fallbackToEnglish && lang !== "en") {
      const qEn = `set:${set} number:${escapeColon(
        number
      )} name:"${name}" include:extras unique:prints lang:en`;
      cards = await fetchCardsByQuery(qEn);
    }
    if (cards.length) return cards[0]; // Return first match
    // fall through to retry without collector number
  }

  // 2) Set + name (without collector number - used as fallback from step 1 or when no number provided)
  if (set) {
    const q = `set:${set} name:"${name}" include:extras unique:${unique} lang:${lang}`;
    let cards = await fetchCardsByQuery(q);
    if (!cards.length && fallbackToEnglish && lang !== "en") {
      const qEn = `set:${set} name:"${name}" include:extras unique:${unique} lang:en`;
      cards = await fetchCardsByQuery(qEn);
    }
    if (cards.length) return cards[0]; // Return first match
    // fall through to name-only query
  }

  // 3) Name-only exact match (prefer language)
  const q = `!"${name}" include:extras unique:${unique} lang:${lang}`;
  let cards = await fetchCardsByQuery(q);
  if (!cards.length && fallbackToEnglish && lang !== "en") {
    const qEn = `!"${name}" include:extras unique:${unique} lang:en`;
    cards = await fetchCardsByQuery(qEn);
  }
  return cards.length ? cards[0] : { imageUrls: [], faces: null, layout: null };
}

/** Escape colon in collector numbers like "321a" (safe) */
function escapeColon(s) {
  return String(s).replace(/:/g, "\\:");
}

/** Run a Scryfall search and collect card data with metadata. Paginates. */
async function fetchCardsByQuery(query) {
  // Use local database if enabled
  if (USE_LOCAL_DB) {
    try {
      const urls = await queryLocalDbForPngs(query);
      // Legacy format: just return URLs without metadata
      return urls.map(url => ({ imageUrls: [url], faces: null, layout: null }));
    } catch (err) {
      console.warn("[LocalDB] Query failed, falling back to API:", query, err?.message);
      // Fall through to API call
    }
  }

  // Use Scryfall API
  const encodedUrl = `${SCRYFALL_API}?q=${encodeURIComponent(query)}`;
  const cards = [];
  let next = encodedUrl;

  try {
    while (next) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const resp = await getWithRetry(next);
      const { data, has_more, next_page } = resp.data;

      for (const card of data || []) {
        const cardData = {
          layout: card.layout,
          set: card.set,
          collector_number: card.collector_number,
          imageUrls: [],
          faces: null
        };

        if (card?.image_uris?.png) {
          // Single-faced card
          cardData.imageUrls.push(card.image_uris.png);
          cardData.faces = [{
            name: card.name,
            imageUrl: card.image_uris.png,
            faceIndex: 0
          }];
        } else if (Array.isArray(card?.card_faces)) {
          // Multi-faced card (transform, modal_dfc, etc.)
          cardData.faces = card.card_faces.map((face, idx) => ({
            name: face.name,
            imageUrl: face?.image_uris?.png,
            faceIndex: idx
          })).filter(f => f.imageUrl);

          cardData.imageUrls = cardData.faces.map(f => f.imageUrl);
        }

        if (cardData.imageUrls.length > 0) {
          cards.push(cardData);
        }
      }

      next = has_more ? next_page : null;
    }
  } catch (err) {
    console.warn("[Scryfall] Query failed:", query, err?.message);
  }

  return cards;
}

// Keep old function for backward compatibility, extract just URLs
async function fetchPngsByQuery(query) {
  const cards = await fetchCardsByQuery(query);
  return cards.flatMap(c => c.imageUrls);
}

module.exports.getImagesForCardInfo = getImagesForCardInfo;
module.exports.fetchCardsByQuery = fetchCardsByQuery;
module.exports.getScryfallPngImagesForCard = async (cardName, unique = "art", language = "en", fallbackToEnglish = true) => {
  // name-only helper with language support
  const q = `!"${cardName}" include:extras unique:${unique} lang:${(language || "en").toLowerCase()}`;
  let urls = await fetchPngsByQuery(q);
  if (!urls.length && fallbackToEnglish && language !== "en") {
    const qEn = `!"${cardName}" include:extras unique:${unique} lang:en`;
    urls = await fetchPngsByQuery(qEn);
  }
  return urls;
};
module.exports.getScryfallPngImagesForCardPrints = async (name, language = "en", fallbackToEnglish = true) => {
  const q = `!"${name}" include:extras unique:prints lang:${(language || "en").toLowerCase()}`;
  let urls = await fetchPngsByQuery(q);
  if (!urls.length && fallbackToEnglish && language !== "en") {
    const qEn = `!"${name}" include:extras unique:prints lang:en`;
    urls = await fetchPngsByQuery(qEn);
  }
  return urls;
};