const axios = require("axios");
const SCRYFALL_API = "https://api.scryfall.com/cards/search";

async function getScryfallPngImagesForCard(cardName, unique = "art") {
  const query = `!"${cardName}" include:extras unique:${unique}`;
  const encodedUrl = `${SCRYFALL_API}?q=${encodeURIComponent(query)}`;
  const allPngUrls = [];
  let nextPageUrl = encodedUrl;

  try {
    while (nextPageUrl) {
      const response = await axios.get(nextPageUrl);
      const { data, has_more, next_page } = response.data;

      for (const card of data) {
        if (card.image_uris?.png) {
          allPngUrls.push(card.image_uris.png);
        } else if (card.card_faces?.length) {
          for (const face of card.card_faces) {
            if (face.image_uris?.png) {
              allPngUrls.push(face.image_uris.png);
            }
          }
        }
      }

      nextPageUrl = has_more ? next_page : null;
    }
  } catch (err) {
    console.warn(
      `[Scryfall] Failed to fetch PNGs for ${cardName}:`,
      err.message
    );
  }

  return allPngUrls;
}

module.exports = {
  getScryfallPngImagesForCard,
  getScryfallPngImagesForCardPrints: (name) =>
    getScryfallPngImagesForCard(name, "prints"),
};
