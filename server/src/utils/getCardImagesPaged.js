const { scryfallGet } = require("./http");
const SCRYFALL_HOST = (
  process.env.SCRYFALL_HOST || "https://api.scryfall.com"
).replace(/\/$/, "");
const cache = new Map();
const quoted = (value) => JSON.stringify(String(value));
function mapCard(card) {
  if (card.digital) return null;
  const image = (value) => value?.png || value?.large || value?.normal;
  // Split/adventure cards have card_faces but only one top-level printed image.
  const single = image(card.image_uris);
  const faces = single
    ? [
        {
          name: card.name,
          imageUrl: single,
          thumbUrl: card.image_uris.normal || card.image_uris.small || single,
          faceIndex: 0,
        },
      ]
    : (card.card_faces || [])
        .map((face, index) => ({
          name: face.name,
          imageUrl: image(face.image_uris),
          thumbUrl:
            face.image_uris?.normal ||
            face.image_uris?.small ||
            image(face.image_uris),
          faceIndex: index,
        }))
        .filter((face) => face.imageUrl);
  return faces.length
    ? {
        name: card.name,
        set: card.set,
        collector_number: card.collector_number,
        layout: card.layout,
        faces,
        imageUrls: faces.map((face) => face.imageUrl),
      }
    : null;
}
async function fetchCardsByQuery(query, signal, maxCards = 1000) {
  const key = `${query}|${maxCards}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.cards;
  let next = `${SCRYFALL_HOST}/cards/search?q=${encodeURIComponent(query)}`;
  const cards = [];
  const visited = new Set();
  while (next && cards.length < maxCards) {
    signal?.throwIfAborted();
    if (
      new URL(next).origin !== new URL(SCRYFALL_HOST).origin ||
      visited.has(next) ||
      visited.size >= 10
    )
      throw new Error("Invalid card-service pagination response.");
    visited.add(next);
    const response = await scryfallGet(next, signal);
    if (!response) break;
    for (const card of response.data || []) {
      const mapped = mapCard(card);
      if (mapped) cards.push(mapped);
      if (cards.length >= maxCards) break;
    }
    next = response.has_more ? response.next_page : null;
  }
  if (cache.size >= 250) cache.delete(cache.keys().next().value);
  cache.set(key, { cards, expires: Date.now() + 60 * 60 * 1000 });
  return cards;
}
async function getImagesForCardInfo(
  info,
  unique = "art",
  language = "en",
  fallbackToEnglish = true,
  signal
) {
  const names = [info.name];
  const languages =
    fallbackToEnglish && language !== "en" ? [language, "en"] : [language];
  const queries = [];
  for (const name of names) {
    if (info.set && info.number)
      queries.push(
        `set:${quoted(info.set)} number:${quoted(info.number)} !${quoted(name)}`
      );
    if (info.set) queries.push(`set:${quoted(info.set)} !${quoted(name)}`);
    queries.push(`!${quoted(name)}`);
  }
  for (const query of queries)
    for (const lang of languages) {
      const cards = await fetchCardsByQuery(
        `${query} include:extras game:paper unique:${unique} lang:${lang}`,
        signal,
        1
      );
      if (cards.length) return cards[0];
    }
  return { imageUrls: [], faces: [], layout: null };
}
module.exports = {
  getImagesForCardInfo,
  fetchCardsByQuery,
  mapCard,
  SCRYFALL_HOST,
  quoted,
};
