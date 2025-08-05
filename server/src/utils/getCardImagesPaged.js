const axios = require("axios");

const SCRYFALL_API = "https://api.scryfall.com/cards/search";

async function getScryfallImagesForCard(cardName) {
  const query = `!"${cardName}" include:extras unique:art`;
  const encodedUrl = `${SCRYFALL_API}?q=${encodeURIComponent(query)}`;

  const allImageUrls = [];
  let nextPageUrl = encodedUrl;

  try {
    while (nextPageUrl) {
      const response = await axios.get(nextPageUrl);
      const { data, has_more, next_page } = response.data;

      data.forEach((card) => {
        if (card.image_uris?.normal) {
          allImageUrls.push(card.image_uris.normal);
        } else if (card.card_faces) {
          card.card_faces.forEach((face) => {
            if (face.image_uris?.normal) {
              allImageUrls.push(face.image_uris.normal);
            }
          });
        }
      });

      nextPageUrl = has_more ? next_page ?? null : null;
    }
  } catch (err) {
    console.warn(`[Scryfall] Failed to fetch images for: ${cardName}`, err.message);
  }

  return allImageUrls;
}

module.exports = { getScryfallImagesForCard };
