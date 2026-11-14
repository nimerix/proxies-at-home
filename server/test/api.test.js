const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
let upstream, server, base;
const queries = [];
before(async () => {
  upstream = http.createServer((req, res) => {
    const url = new URL(req.url, "http://test");
    const q = url.searchParams.get("q") || "";
    queries.push(q);
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/sets")
      return res.end(
        JSON.stringify({ data: [{ code: "c21", name: "Commander 2021" }] })
      );
    if (url.pathname.endsWith("autocomplete"))
      return res.end(JSON.stringify({ data: ["Sol Ring"] }));
    if (q.includes("Missing") || q.includes("lang:fr")) {
      res.statusCode = 404;
      return res.end("{}");
    }
    const set = q.includes('set:"cmr"') ? "cmr" : "c21";
    res.end(
      JSON.stringify({
        data: [
          {
            name: "Sol Ring",
            set,
            collector_number: set === "cmr" ? "334" : "263",
            image_uris: { png: `https://cards.scryfall.io/${set}.png` },
          },
        ],
        has_more: false,
      })
    );
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  process.env.SCRYFALL_HOST = `http://127.0.0.1:${upstream.address().port}`;
  process.env.LOG_LEVEL = "silent";
  const { app } = require("../dist/index.js");
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/cards/images`;
});
after(async () => {
  await Promise.all([
    new Promise((r) => server.close(r)),
    new Promise((r) => upstream.close(r)),
  ]);
});
const post = (body) =>
  fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("echoes exact request identity without conflating printings", async () => {
  const result = await post({
    cardQueries: [
      { name: "Sol Ring", set: "c21" },
      { name: "Sol Ring", set: "cmr" },
    ],
  });
  assert.equal(result.status, 200);
  const cards = await result.json();
  assert.equal(cards[0].query.set, "c21");
  assert.equal(cards[1].query.set, "cmr");
  assert.notEqual(cards[0].imageUrls[0], cards[1].imageUrls[0]);
});
test("falls back from an absent translation to English and reports not found", async () => {
  const result = await post({
    cardNames: ["Sol Ring", "Missing"],
    language: "fr",
  });
  const cards = await result.json();
  assert.equal(cards[0].imageUrls.length, 1);
  assert.deepEqual(cards[1].imageUrls, []);
});
test("all-printings queries exclude digital cards", async () => {
  const result = await post({ cardNames: ["Sol Ring"], cardArt: "prints" });
  assert.equal(result.status, 200);
  assert.ok(queries.some((q) => q.includes("game:paper unique:prints")));
});
test("rejects malformed and excessive API input", async () => {
  for (const body of [
    null,
    {},
    { cardQueries: [null] },
    { cardNames: [7] },
    { cardNames: ["Sol Ring"], language: 42 },
    { cardNames: Array(101).fill("Sol Ring") },
    { cardNames: ["Sol Ring"], cardArt: "invalid" },
  ]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body));
  }
});
test("proxy rejects private, credentialed, untrusted, relative and non-HTTPS URLs", async () => {
  for (const url of [
    "http://127.0.0.1/secret",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
    "https://cards.scryfall.io.evil.example/a.png",
    "https://user@cards.scryfall.io/a.png",
    "/cardback.png",
    "https://cards.scryfall.io:8080/a.png",
  ]) {
    assert.equal(
      (await fetch(`${base}/proxy?url=${encodeURIComponent(url)}`)).status,
      400,
      url
    );
  }
});
test("removes public destructive and unused upload endpoints", async () => {
  assert.equal((await fetch(base, { method: "DELETE" })).status, 404);
  assert.equal((await fetch(`${base}/upload`, { method: "POST" })).status, 404);
  assert.equal(
    (await fetch(`${base}/images-stream`, { method: "POST" })).status,
    404
  );
});
test("handles split cards and DFCs correctly", () => {
  const { mapCard } = require("../src/utils/getCardImagesPaged");
  const split = mapCard({
    name: "Fire // Ice",
    image_uris: { png: "split.png" },
    card_faces: [{ name: "Fire" }, { name: "Ice" }],
  });
  assert.deepEqual(split.imageUrls, ["split.png"]);
  assert.equal(split.faces.length, 1);
  const dfc = mapCard({
    name: "Front // Back",
    card_faces: [
      { name: "Front", image_uris: { png: "front.png" } },
      { name: "Back", image_uris: { png: "back.png" } },
    ],
  });
  assert.deepEqual(dfc.imageUrls, ["front.png", "back.png"]);
  assert.equal(mapCard({ digital: true }), null);
});
test("keeps thumbnail URLs separate from original card images", () => {
  const { mapCard } = require("../src/utils/getCardImagesPaged");
  const card = mapCard({
    name: "Sol Ring",
    image_uris: { png: "original.png", normal: "thumbnail.jpg" },
  });
  assert.equal(card.faces[0].thumbUrl, "thumbnail.jpg");
  assert.equal(card.imageUrls[0], "original.png");
});
