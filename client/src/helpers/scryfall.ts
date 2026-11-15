import { cardKey, type CardInfo } from "@/helpers/CardInfoHelper";
import type { CardFace } from "@/types/Card";

const SCRYFALL_API = (
  (import.meta.env.VITE_SCRYFALL_HOST as string | undefined) ||
  "https://api.scryfall.com"
).replace(/\/$/, "");

// Scryfall allows 2 requests per second to its card search and lookup
// endpoints and 10 per second to the rest; going over risks an IP ban.
const LIMITED_PATH = /^\/cards\/(?:search|named|random|collection)$/;
const LIMITED_GAP_MS = 520;
const OTHER_GAP_MS = 110;
const REQUEST_TIMEOUT_MS = 15000;
const SEARCH_CACHE_MS = 60 * 60 * 1000;
const SEARCH_CACHE_SIZE = 250;
const MAX_SEARCH_PAGES = 10;

export type FoundCard = {
  name: string;
  set?: string;
  number?: string;
  layout?: string;
  faces: CardFace[];
  imageUrls: string[];
  query?: CardInfo;
};

type ScryfallImages = {
  png?: string;
  large?: string;
  normal?: string;
  small?: string;
};
type ScryfallCard = {
  name: string;
  set?: string;
  collector_number?: string;
  layout?: string;
  digital?: boolean;
  image_uris?: ScryfallImages;
  card_faces?: { name: string; image_uris?: ScryfallImages }[];
};
type ScryfallList<T> = { data?: T[]; has_more?: boolean; next_page?: string };
export type SetInfo = { code: string; name: string; released_at?: string };

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

// Spaces request start times so they never exceed the endpoint's rate.
function spacedStarts(gapMs: number) {
  let next = 0;
  return (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gapMs;
    return at > now ? delay(at - now, signal) : Promise.resolve();
  };
}
const limitedSlot = spacedStarts(LIMITED_GAP_MS);
const otherSlot = spacedStarts(OTHER_GAP_MS);

async function scryfallGet<T>(url: string, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await (LIMITED_PATH.test(new URL(url).pathname) ? limitedSlot : otherSlot)(
      signal
    );
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json;q=0.9,*/*;q=0.8" },
        credentials: "omit",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      signal?.throwIfAborted();
      if (timeout.aborted)
        throw new Error("The card search timed out. Try again.", {
          cause: error,
        });
      throw new Error(
        "Could not reach the card search. Check your connection and try again.",
        { cause: error }
      );
    }
    if (response.status === 404) return null;
    if (response.ok) return (await response.json()) as T;
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const seconds = Math.min(
        10,
        Math.max(1, Number(response.headers.get("retry-after")) || 2 ** attempt)
      );
      await delay(seconds * 1000, signal);
      continue;
    }
    throw new Error(
      `The card search returned HTTP ${response.status}. Try again shortly.`
    );
  }
  throw new Error("The card search is busy. Try again shortly.");
}

export function mapCard(card: ScryfallCard): FoundCard | null {
  if (card.digital) return null;
  const image = (value?: ScryfallImages) =>
    value?.png || value?.large || value?.normal;
  // Split/adventure cards have card_faces but only one top-level printed image.
  const single = image(card.image_uris);
  const faces: CardFace[] = single
    ? [
        {
          name: card.name,
          imageUrl: single,
          thumbUrl: card.image_uris!.normal || card.image_uris!.small || single,
          faceIndex: 0,
        },
      ]
    : (card.card_faces || [])
        .map((face, index) => ({
          name: face.name,
          imageUrl: image(face.image_uris) ?? "",
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
        number: card.collector_number,
        layout: card.layout,
        faces,
        imageUrls: faces.map((face) => face.imageUrl),
      }
    : null;
}

const searches = new Map<string, { cards: FoundCard[]; expires: number }>();
const quoted = (value: string) => JSON.stringify(String(value));
// Scryfall rejects longer search queries.
const MAX_QUERY_LENGTH = 1000;
const SEARCH_PAGE_SIZE = 175;

function remember<T>(
  cache: Map<string, { cards: T; expires: number }>,
  key: string,
  cards: T
) {
  if (cache.size >= SEARCH_CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, { cards, expires: Date.now() + SEARCH_CACHE_MS });
}

const invalidPage = () =>
  new Error("The card search returned an invalid page.");

// Reads pages until `onPage` returns true or none are left. Returns false
// when the page limit stopped it first.
async function searchPages(
  query: string,
  signal: AbortSignal | undefined,
  onPage: (cards: ScryfallCard[]) => boolean
) {
  let next: string | null | undefined =
    `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}`;
  const visited = new Set<string>();
  while (next) {
    if (
      new URL(next).origin !== new URL(SCRYFALL_API).origin ||
      visited.has(next)
    )
      throw invalidPage();
    if (visited.size >= MAX_SEARCH_PAGES) return false;
    visited.add(next);
    const page: ScryfallList<ScryfallCard> | null = await scryfallGet(
      next,
      signal
    );
    if (!page || onPage(page.data || [])) return true;
    next = page.has_more ? page.next_page : null;
  }
  return true;
}

async function searchCards(
  query: string,
  signal?: AbortSignal,
  maxCards = 1000
) {
  const key = `${query}|${maxCards}`;
  const cached = searches.get(key);
  if (cached && cached.expires > Date.now()) return cached.cards;
  const cards: FoundCard[] = [];
  const read = await searchPages(query, signal, (page) => {
    for (const card of page) {
      const mapped = mapCard(card);
      if (mapped) cards.push(mapped);
      if (cards.length >= maxCards) return true;
    }
    return false;
  });
  if (!read) throw invalidPage();
  remember(searches, key, cards);
  return cards;
}

const languagesFor = (language: string, fallbackToEnglish: boolean) =>
  fallbackToEnglish && language !== "en" ? [language, "en"] : [language];

// Scryfall matches exact names without regard to case or accents.
const normalName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const cardNames = (card: ScryfallCard) =>
  [card.name, ...(card.card_faces ?? []).map((face) => face.name)].map(
    normalName
  );

type Tier = "exact" | "set" | "name";
type Step = { tier: Tier; lang: string };
type Lookup = { info: CardInfo; steps: Step[]; step: number; solo: boolean };
type Hit = { names: string[]; card: FoundCard };
// `complete` means every page was read; `stray` means a returned card matched
// none of the requested names, so an absent name may still exist.
type Batch = { hits: Hit[]; complete: boolean; stray: boolean };
const batches = new Map<string, { cards: Batch; expires: number }>();

function stepsFor(info: CardInfo, langs: string[]): Step[] {
  const tiers: Tier[] = [
    ...(info.set && info.number ? (["exact"] as const) : []),
    ...(info.set ? (["set"] as const) : []),
    "name",
  ];
  return tiers.flatMap((tier) => langs.map((lang) => ({ tier, lang })));
}

const suffix = (lang: string, unique = "art") =>
  ` include:extras game:paper unique:${unique} lang:${lang}`;

function soloQuery(info: CardInfo, { tier, lang }: Step) {
  const name = `!${quoted(info.name)}`;
  if (tier === "exact")
    return `set:${quoted(info.set!)} number:${quoted(info.number!)} ${name}${suffix(lang)}`;
  if (tier === "set") return `set:${quoted(info.set!)} ${name}${suffix(lang)}`;
  return `${name}${suffix(lang)}`;
}

// Splits names into `or` searches that each fit Scryfall's query length.
function batchQueries(names: string[], prefix: string, end: string) {
  const query = (group: string[]) =>
    `${prefix}${
      group.length === 1
        ? `!${quoted(group[0])}`
        : `(${group.map((name) => `!${quoted(name)}`).join(" or ")})`
    }${end}`;
  const groups: string[][] = [];
  for (const name of names) {
    const last = groups.at(-1);
    if (last && query([...last, name]).length <= MAX_QUERY_LENGTH)
      last.push(name);
    else groups.push([name]);
  }
  return groups.map((group) => ({ names: group, query: query(group) }));
}

async function searchBatch(
  query: string,
  names: string[],
  settled: (hits: Hit[]) => boolean,
  signal?: AbortSignal
): Promise<Batch> {
  const cached = batches.get(query);
  if (cached && cached.expires > Date.now()) return cached.cards;
  const wanted = new Set(names.map(normalName));
  const batch: Batch = { hits: [], complete: false, stray: false };
  // When the page limit stops it, missing cards are looked up on their own.
  batch.complete =
    (await searchPages(query, signal, (page) => {
      for (const card of page) {
        const matched = cardNames(card).filter((name) => wanted.has(name));
        if (!matched.length) batch.stray = true;
        const mapped = matched.length ? mapCard(card) : null;
        if (mapped) batch.hits.push({ names: matched, card: mapped });
      }
      return settled(batch.hits);
    })) && !settled(batch.hits);
  if (batch.complete) remember(batches, query, batch);
  return batch;
}

const found = (info: CardInfo, card: FoundCard): FoundCard => ({
  ...card,
  name: card.name || info.name,
  number: card.number || info.number,
  query: info,
});
const notFound = (info: CardInfo): FoundCard => ({
  name: info.name,
  number: info.number,
  imageUrls: [],
  faces: [],
  query: info,
});

function matches(hit: Hit, lookup: Lookup, tier: Tier) {
  return (
    hit.names.includes(normalName(lookup.info.name)) &&
    (tier !== "exact" ||
      hit.card.number?.toLowerCase() === lookup.info.number?.toLowerCase())
  );
}

// `!"Lightning Bolt"` also finds "Emeritus of Conflict // Lightning Bolt".
// Prefer the card with exactly the name, then one whose front face has it.
// Results are sorted by name, so "X" comes before "X // Y".
function nameRank(card: FoundCard, name: string) {
  if (normalName(card.name) === name) return 0;
  return normalName(card.name.split(" // ")[0]) === name ? 1 : 2;
}

function bestCard<T>(items: T[], card: (item: T) => FoundCard, name: string) {
  const wanted = normalName(name);
  let best: T | undefined;
  for (const item of items)
    if (
      best === undefined ||
      nameRank(card(item), wanted) < nameRank(card(best), wanted)
    )
      best = item;
  return best;
}

/** The most specific printing for each card, trying the same queries in the
 * same order as one search per card: the exact printing, then the set, then
 * any printing, each in the requested language and then English. Cards that
 * share a step are searched together with `or`. */
export async function findCardsArt(
  infos: CardInfo[],
  language = "en",
  fallbackToEnglish = true,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, FoundCard>> {
  const langs = languagesFor(language, fallbackToEnglish);
  const results = new Map<string, FoundCard>();
  const unique = [...new Map(infos.map((info) => [cardKey(info), info]))];
  let pending: Lookup[] = unique.map(([, info]) => ({
    info,
    steps: stepsFor(info, langs),
    step: 0,
    solo: false,
  }));
  const settle = (lookup: Lookup, card: FoundCard | null) => {
    results.set(
      cardKey(lookup.info),
      card ? found(lookup.info, card) : notFound(lookup.info)
    );
    onProgress?.(results.size, unique.length);
  };
  while (pending.length) {
    const next: Lookup[] = [];
    const advance = (lookup: Lookup) => {
      if (++lookup.step < lookup.steps.length) next.push(lookup);
      else settle(lookup, null);
    };
    const groups = new Map<string, Lookup[]>();
    for (const lookup of pending) {
      const { tier, lang } = lookup.steps[lookup.step];
      const set = tier === "name" ? "" : lookup.info.set!.toLowerCase();
      const key = lookup.solo
        ? `solo|${cardKey(lookup.info)}|${lookup.step}`
        : `${tier}|${set}|${lang}`;
      groups.set(key, [...(groups.get(key) ?? []), lookup]);
    }
    const work: Promise<void>[] = [];
    for (const group of groups.values()) {
      const { tier, lang } = group[0].steps[group[0].step];
      const names = [
        ...new Map(
          group.map((lookup) => [
            normalName(lookup.info.name),
            lookup.info.name,
          ])
        ).values(),
      ];
      if (names.length === 1 && (tier !== "exact" || group.length === 1)) {
        work.push(
          // One page, so a later exact name can win over an earlier face.
          searchCards(
            soloQuery(group[0].info, group[0].steps[group[0].step]),
            signal,
            SEARCH_PAGE_SIZE
          ).then((cards) => {
            const card = bestCard(cards, (c) => c, group[0].info.name);
            for (const lookup of group) {
              lookup.solo = false;
              if (card) settle(lookup, card);
              else advance(lookup);
            }
          })
        );
        continue;
      }
      const prefix =
        tier === "name" ? "" : `set:${quoted(group[0].info.set!)} `;
      const end = suffix(lang, tier === "exact" ? "prints" : "art");
      for (const chunk of batchQueries(names, prefix, end)) {
        const members = new Set(chunk.names.map(normalName));
        const lookups = group.filter((lookup) =>
          members.has(normalName(lookup.info.name))
        );
        const settled = (hits: Hit[]) =>
          lookups.every((lookup) =>
            hits.some(
              (hit) =>
                matches(hit, lookup, tier) &&
                nameRank(hit.card, normalName(lookup.info.name)) < 2
            )
          );
        work.push(
          searchBatch(chunk.query, chunk.names, settled, signal).then(
            (batch) => {
              for (const lookup of lookups) {
                const hit = bestCard(
                  batch.hits.filter((h) => matches(h, lookup, tier)),
                  (h) => h.card,
                  lookup.info.name
                );
                if (hit) settle(lookup, hit.card);
                // A missing exact printing is confirmed by its own search.
                else if (tier !== "exact" && batch.complete && !batch.stray)
                  advance(lookup);
                else {
                  lookup.solo = true;
                  next.push(lookup);
                }
              }
            }
          )
        );
      }
    }
    await Promise.all(work);
    pending = next;
  }
  return results;
}

// The most specific printing that matches, in the requested language first.
export async function findCardArt(
  info: CardInfo,
  language = "en",
  fallbackToEnglish = true,
  signal?: AbortSignal
): Promise<FoundCard> {
  const results = await findCardsArt(
    [info],
    language,
    fallbackToEnglish,
    signal
  );
  return results.get(cardKey(info)) ?? notFound(info);
}

export async function findPrintings(
  name: string,
  language = "en",
  fallbackToEnglish = true,
  signal?: AbortSignal
): Promise<FoundCard[]> {
  for (const lang of languagesFor(language, fallbackToEnglish)) {
    const cards = await searchCards(
      `!${quoted(name)} include:extras game:paper unique:prints lang:${lang}`,
      signal
    );
    if (cards.length)
      return cards.map((card) => ({ ...card, query: { name } }));
  }
  return [];
}

export async function autocompleteCardNames(
  query: string,
  signal?: AbortSignal
) {
  const result: ScryfallList<string> | null = await scryfallGet(
    `${SCRYFALL_API}/cards/autocomplete?q=${encodeURIComponent(query)}`,
    signal
  );
  return result?.data ?? [];
}

let setsRequest: Promise<SetInfo[]> | null = null;
export function getSets() {
  setsRequest ??= scryfallGet<ScryfallList<SetInfo>>(`${SCRYFALL_API}/sets`)
    .then((result) => result?.data ?? [])
    .catch(() => {
      setsRequest = null;
      return [];
    });
  return setsRequest;
}
