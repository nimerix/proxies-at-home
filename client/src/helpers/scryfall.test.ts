import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { findCardArt, findCardsArt, findPrintings, mapCard } from "./scryfall";

const queries: string[] = [];
const solRing = (set: string) => ({
  name: "Sol Ring",
  set,
  collector_number: set === "cmr" ? "334" : "263",
  image_uris: {
    png: `https://cards.scryfall.io/${set}.png`,
    normal: `https://cards.scryfall.io/${set}.jpg`,
  },
});

beforeEach(() => {
  queries.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input);
      const q = url.searchParams.get("q") ?? "";
      queries.push(q);
      if (q.includes("Missing") || q.includes("lang:fr"))
        return Response.json({ object: "error" }, { status: 404 });
      return Response.json({
        data: [
          solRing(q.includes('set:"cmr"') ? "cmr" : "c21"),
          { ...solRing("pz1"), digital: true },
        ],
        has_more: false,
      });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

test("keeps the requested identity without conflating printings", async () => {
  const c21 = await findCardArt({ name: "Sol Ring", set: "c21" });
  const cmr = await findCardArt({ name: "Sol Ring", set: "cmr" });
  expect(c21.query?.set).toBe("c21");
  expect(cmr.query?.set).toBe("cmr");
  expect(cmr.number).toBe("334");
  expect(c21.imageUrls[0]).not.toBe(cmr.imageUrls[0]);
  expect(queries[0]).toBe(
    'set:"c21" !"Sol Ring" include:extras game:paper unique:art lang:en'
  );
});

test("tries the exact printing, then the set, then any printing", async () => {
  await findCardArt({ name: "Missing", set: "abc", number: "12" });
  expect(queries).toEqual([
    'set:"abc" number:"12" !"Missing" include:extras game:paper unique:art lang:en',
    'set:"abc" !"Missing" include:extras game:paper unique:art lang:en',
    '!"Missing" include:extras game:paper unique:art lang:en',
  ]);
});

test("falls back from an absent translation to English and reports not found", async () => {
  const found = await findCardArt({ name: "Sol Ring" }, "fr");
  expect(found.imageUrls).toHaveLength(1);
  expect(queries.map((q) => q.slice(-7))).toEqual(["lang:fr", "lang:en"]);
  const missing = await findCardArt({ name: "Missing", number: "7" }, "fr");
  expect(missing).toMatchObject({
    name: "Missing",
    number: "7",
    imageUrls: [],
  });
  expect(
    await findCardArt({ name: "Sol Ring", set: "c21" }, "fr", false)
  ).toMatchObject({ imageUrls: [] });
});

test("all-printings searches stay on paper and drop digital printings", async () => {
  const prints = await findPrintings("Sol Ring");
  expect(queries).toEqual([
    '!"Sol Ring" include:extras game:paper unique:prints lang:en',
  ]);
  expect(prints.map((p) => p.set)).toEqual(["c21"]);
});

test("refuses pagination that leaves Scryfall", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: [solRing("c21")],
        has_more: true,
        next_page: "https://evil.example/cards/search?page=2",
      })
    )
  );
  await expect(findPrintings("Paginated Card")).rejects.toThrow(/invalid page/);
});

test("explains an unreachable card search", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    })
  );
  await expect(findCardArt({ name: "Offline Card" })).rejects.toThrow(
    /Could not reach the card search/
  );
});

test("handles split cards and double-faced cards", () => {
  const split = mapCard({
    name: "Fire // Ice",
    image_uris: { png: "split.png" },
    card_faces: [{ name: "Fire" }, { name: "Ice" }],
  });
  expect(split?.imageUrls).toEqual(["split.png"]);
  expect(split?.faces).toHaveLength(1);
  const dfc = mapCard({
    name: "Front // Back",
    card_faces: [
      { name: "Front", image_uris: { png: "front.png" } },
      { name: "Back", image_uris: { png: "back.png" } },
    ],
  });
  expect(dfc?.imageUrls).toEqual(["front.png", "back.png"]);
  expect(mapCard({ name: "Digital", digital: true })).toBeNull();
});

test("keeps thumbnail URLs separate from original card images", () => {
  const card = mapCard({
    name: "Sol Ring",
    image_uris: { png: "original.png", normal: "thumbnail.jpg" },
  });
  expect(card?.faces[0].thumbUrl).toBe("thumbnail.jpg");
  expect(card?.imageUrls[0]).toBe("original.png");
});

test("starts at most two card searches per second", async () => {
  const starts: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      starts.push(Date.now());
      return Response.json({ data: [solRing("c21")], has_more: false });
    })
  );
  await Promise.all(
    ["Rate A", "Rate B", "Rate C"].map((name) => findCardArt({ name }))
  );
  expect(starts).toHaveLength(3);
  for (let i = 1; i < starts.length; i++)
    expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(500);
});

test("searches cards that share a step together and keeps each card's fallbacks", async () => {
  const card = (
    name: string,
    set: string,
    number: string,
    digital = false
  ) => ({
    name,
    set,
    collector_number: number,
    digital,
    image_uris: { png: `https://cards.scryfall.io/${set}-${number}.png` },
  });
  const printings: Record<string, ReturnType<typeof card>[]> = {
    "Batch A": [card("Batch A", "new", "1"), card("Batch A", "old", "2")],
    "Batch B": [card("Batch B", "dig", "3", true), card("Batch B", "new", "4")],
    "Batch C": [card("Batch C", "alt", "5"), card("Batch C", "alt", "6")],
    "Batch D": [card("Batch D", "new", "7")],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const q = new URL(input).searchParams.get("q") ?? "";
      queries.push(q);
      const set = q.match(/set:"(\w+)"/)?.[1];
      const number = q.match(/number:"(\w+)"/)?.[1];
      const data = [...q.matchAll(/!"([^"]+)"/g)].flatMap(([, name]) =>
        (
          Object.entries(printings).find(
            ([key]) => key.toLowerCase() === name.toLowerCase()
          )?.[1] ?? []
        ).filter(
          (c) =>
            (!set || c.set === set) &&
            (!number || c.collector_number === number) &&
            !c.digital
        )
      );
      return data.length
        ? Response.json({ data, has_more: false })
        : Response.json({ object: "error" }, { status: 404 });
    })
  );
  const results = await findCardsArt([
    { name: "Batch A" },
    { name: "batch b" },
    { name: "Batch C", set: "alt", number: "6" },
    { name: "Batch A", set: "alt", number: "9" },
    { name: "Batch D", set: "old" },
    { name: "Missing" },
  ]);
  const pick = (key: string) => {
    const found = results.get(key);
    return found && [found.set, found.number, found.imageUrls.length];
  };
  expect(pick("batch a||")).toEqual(["new", "1", 1]);
  expect(pick("batch b||")).toEqual(["new", "4", 1]);
  expect(pick("batch c|alt|6")).toEqual(["alt", "6", 1]);
  expect(pick("batch a|alt|9")).toEqual(["new", "1", 1]);
  expect(pick("batch d|old|")).toEqual(["new", "7", 1]);
  expect(pick("missing||")).toEqual([undefined, undefined, 0]);
  expect(queries).toEqual([
    '(!"Batch A" or !"batch b" or !"Missing") include:extras game:paper unique:art lang:en',
    'set:"alt" (!"Batch C" or !"Batch A") include:extras game:paper unique:prints lang:en',
    'set:"old" !"Batch D" include:extras game:paper unique:art lang:en',
    'set:"alt" number:"9" !"Batch A" include:extras game:paper unique:art lang:en',
    '!"Batch D" include:extras game:paper unique:art lang:en',
    'set:"alt" !"Batch A" include:extras game:paper unique:art lang:en',
    '!"Batch A" include:extras game:paper unique:art lang:en',
  ]);
});

test("keeps batched searches within Scryfall's query length", async () => {
  const names = Array.from({ length: 80 }, (_, i) => `Long Card Name ${i}`);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      queries.push(new URL(input).searchParams.get("q") ?? "");
      return Response.json({ object: "error" }, { status: 404 });
    })
  );
  await findCardsArt(names.map((name) => ({ name })));
  expect(queries.length).toBeGreaterThan(1);
  for (const q of queries) expect(q.length).toBeLessThanOrEqual(1000);
  const searched = queries.flatMap((q) =>
    [...q.matchAll(/!"([^"]+)"/g)].map(([, name]) => name)
  );
  expect(searched.sort()).toEqual([...names].sort());
});

test("prefers the card named exactly as asked over one with that name on a face", async () => {
  const card = (name: string, set: string, faces?: string[]) => ({
    name,
    set,
    collector_number: "1",
    ...(faces
      ? {
          card_faces: faces.map((face) => ({
            name: face,
            image_uris: { png: `https://cards.scryfall.io/${set}-${face}.png` },
          })),
        }
      : { image_uris: { png: `https://cards.scryfall.io/${set}.png` } }),
  });
  // Scryfall sorts by name, so the card with "Lightning Bolt" on its back
  // face comes first, as it does for `!"Lightning Bolt"`.
  const results: Record<string, unknown[]> = {
    "Lightning Bolt": [
      card("Emeritus of Conflict // Lightning Bolt", "sos", [
        "Emeritus of Conflict",
        "Lightning Bolt",
      ]),
      card("Lightning Bolt", "msc"),
      card("Lightning Bolt // Lightning Bolt", "astx", [
        "Lightning Bolt",
        "Lightning Bolt",
      ]),
    ],
    "Delver of Secrets": [
      card("Delver of Secrets // Insectile Aberration", "isd", [
        "Delver of Secrets",
        "Insectile Aberration",
      ]),
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const q = new URL(input).searchParams.get("q") ?? "";
      queries.push(q);
      const data = Object.entries(results)
        .filter(([name]) => q.includes(`!"${name}"`))
        .flatMap(([, cards]) => cards);
      return data.length
        ? Response.json({ data, has_more: false })
        : Response.json({ object: "error" }, { status: 404 });
    })
  );
  expect((await findCardArt({ name: "Lightning Bolt" })).set).toBe("msc");
  const batched = await findCardsArt([
    { name: "Lightning Bolt", set: "zzz" },
    { name: "Delver of Secrets", set: "zzz" },
  ]);
  expect(queries.at(-1)).toContain(
    '(!"Lightning Bolt" or !"Delver of Secrets")'
  );
  expect(batched.get("lightning bolt|zzz|")?.set).toBe("msc");
  expect(batched.get("delver of secrets|zzz|")?.set).toBe("isd");
});
