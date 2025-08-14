const axios = require("axios");

const SCRYFALL_API = "https://api.scryfall.com/cards/search";

// Optional: a polite UA helps if you get rate-limited
const AX = axios.create({
  headers: { "User-Agent": "Proxxied/1.0 (contact: your-email@example.com)" },
});

/**
 * Core: given a CardInfo { name, set?, number? }, return PNG urls.
 * If set && number => try exact printing; else set+name; else name-only.
 * `unique` can be "art" or "prints".
 */
async function getImagesForCardInfo(cardInfo, unique = "art") {
  const { name, set, number } = cardInfo || {};

  // 1) Exact printing: set + collector number + name
  if (set && number) {
    const q = `set:${set} number:${escapeColon(number)} name:"${name}" include:extras unique:prints`;
    const urls = await fetchPngsByQuery(q);
    if (urls.length) return urls;
    // fallback if exact failed (mis-typed number or edge cases)
  }

  // 2) Set + name (all printings in set for that name)
  if (set && !number) {
    const q = `set:${set} name:"${name}" include:extras unique:${unique}`;
    const urls = await fetchPngsByQuery(q);
    if (urls.length) return urls;
    // fallback if empty
  }

  // 3) Name-only exact match (your current behavior)
  const q = `!"${name}" include:extras unique:${unique}`;
  return fetchPngsByQuery(q);
}

/** Escape colon in collector numbers like "321a" (safe) */
function escapeColon(s) {
  return String(s).replace(/:/g, "\\:");
}

/** Run a Scryfall search and collect PNGs (handles DFC). Paginates. */
async function fetchPngsByQuery(query) {
  const encodedUrl = `${SCRYFALL_API}?q=${encodeURIComponent(query)}`;
  const pngs = [];
  let next = encodedUrl;

  try {
    while (next) {
      const resp = await AX.get(next);
      const { data, has_more, next_page } = resp.data;

      for (const card of data || []) {
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

      next = has_more ? next_page : null;
    }
  } catch (err) {
    console.warn("[Scryfall] Query failed:", query, err?.message);
  }

  return pngs;
}

module.exports = {
  getImagesForCardInfo,
  // Back-compat helpers if you still use name-only paths elsewhere:
  getScryfallPngImagesForCard: async (cardName, unique = "art") => {
    const q = `!"${cardName}" include:extras unique:${unique}`;
    return fetchPngsByQuery(q);
  },
  getScryfallPngImagesForCardPrints: async (name) => {
    const q = `!"${name}" include:extras unique:prints`;
    return fetchPngsByQuery(q);
  },
};
