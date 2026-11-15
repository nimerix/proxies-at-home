// Performance benchmark for Oops, All Proxies.
//
// Runs the production build in Chromium against an emulated Scryfall that
// enforces Scryfall's published rate limits (2 requests per second for
// /cards/search, /cards/named, /cards/random and /cards/collection; 10 per
// second for other API endpoints). A run that breaks a limit, or produces a
// wrong deck or PDF, is invalid and gets no score.
//
//   npm run build --prefix client
//   node bench/perf.mjs [--runs 3] [--out .artifacts/perf/name.json]
//                       [--baseline .artifacts/perf/baseline.json]
//
// Every metric is "lower is better". The score is the geometric mean of
// baseline/current over the scored metrics, so 1.25 means 25% better overall.
// load_ms is reported but not scored: at ~60 ms its run-to-run noise is about
// 30%, and initial_js_gzip_kb measures load cost deterministically.

import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const benchRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Checks use this checkout's pdf-lib and JSZip, not the candidate's.
const requireClient = createRequire(join(benchRoot, "client/package.json"));
const { PDFDocument } = requireClient("pdf-lib");
const JSZip = requireClient("jszip");

const args = {};
for (let i = 2; i < process.argv.length; i += 2)
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
// --root benchmarks another checkout's client build with this script.
const root = args.root ? resolve(args.root) : benchRoot;
const RUNS = Number(args.runs ?? 3);
const PORT = Number(args.port ?? 4180);
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT = Number(args.timeout ?? 240000);

export const METRICS = [
  "load_ms",
  "initial_js_gzip_kb",
  "import_ms",
  "first_sheet_ms",
  "browse_all_ms",
  "rerender_ms",
  "zip_ms",
  "pdf_ms",
  "pdf_peak_heap_mb",
  "mpc_first_sheet_ms",
];

const SCORED = METRICS.filter((k) => k !== "load_ms");

// Emulated network latency, in milliseconds.
const LATENCY = { limited: 150, other: 60, cdn: 40, drive: 200 };

// ---------------------------------------------------------------- the deck

const UNKNOWN = "Unknown Card Name";
const DFC = "Delver of Secrets // Insectile Aberration";
const SPLIT = "Fire // Ice";
const generic = Array.from(
  { length: 55 },
  (_, i) => `Bench Card ${String(i + 1).padStart(2, "0")}`
);
const setOnly = generic.slice(0, 3);
const printed = Array.from({ length: 10 }, (_, i) => ({
  name: `Bench Printed ${String(i + 1).padStart(2, "0")}`,
  set: "alt",
  number: String(200 + i),
}));
const DECK_LINES = [
  ...generic.map((n) => (setOnly.includes(n) ? `1 ${n} (old)` : `1 ${n}`)),
  `1 ${SPLIT}`,
  `1 ${DFC}`,
  "1 Hit It!",
  "1 Elas il-Kor, Sadistic Pilgrim",
  ...printed.map((c) => `1 ${c.name} (${c.set}) ${c.number}`),
  "15 Island",
  "15 Mountain",
  `1 ${UNKNOWN}`,
];
const DECK = DECK_LINES.join("\n");
const EXPECTED_NAMES = DECK_LINES.flatMap((line) => {
  const [, qty, rest] = line.match(/^(\d+) (.+?)(?: \(\w+\)(?: \d+)?)?$/);
  return Array(Number(qty)).fill(rest);
});
const CARD_COUNT = EXPECTED_NAMES.length; // 100
const SHEET_SIZE = 9;

// ------------------------------------------------------- emulated Scryfall

const hash = (s) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const LEGAL = Object.fromEntries(
  [
    "standard",
    "future",
    "historic",
    "timeless",
    "gladiator",
    "pioneer",
    "explorer",
    "modern",
    "legacy",
    "pauper",
    "vintage",
    "penny",
    "commander",
    "oathbreaker",
    "standardbrawl",
    "brawl",
    "alchemy",
    "paupercommander",
    "duel",
    "oldschool",
    "premodern",
    "predh",
  ].map((f) => [f, "legal"])
);

function cardImages(set, name, number, digital) {
  const base = `https://cards.scryfall.io/%s/front/${set}/${digital ? "digital/" : ""}${slug(name)}-${number}`;
  const at = (kind, ext) => base.replace("%s", kind) + ext;
  return {
    small: at("small", ".jpg"),
    normal: at("normal", ".jpg"),
    large: at("large", ".jpg"),
    png: at("png", ".png"),
    art_crop: at("art_crop", ".jpg"),
    border_crop: at("border_crop", ".jpg"),
  };
}

function printingsOf(name) {
  if (name.toLowerCase() === UNKNOWN.toLowerCase()) return [];
  const h = hash(name);
  const fixed = printed.find((c) => c.name === name);
  const sets = [
    // One name in eight has a newer digital-only printing.
    ...(h % 8 === 0
      ? [{ set: "dig", digital: true, released_at: "2026-06-01" }]
      : []),
    { set: "new", released_at: "2025-02-07" },
    { set: "alt", released_at: "2020-04-24" },
    { set: "old", released_at: "2010-10-01" },
  ];
  return sets.map(({ set, digital = false, released_at }) => {
    const number =
      set === "alt" && fixed
        ? fixed.number
        : String(
            KNOWN_NAMES.includes(name)
              ? 300 + KNOWN_NAMES.indexOf(name)
              : 1000 + (h % 1000)
          );
    const id = `${slug(name)}-${set}`;
    const card = {
      object: "card",
      id,
      oracle_id: slug(name),
      lang: "en",
      name,
      released_at,
      uri: `https://api.scryfall.com/cards/${id}`,
      scryfall_uri: `https://scryfall.com/card/${set}/${number}/${slug(name)}`,
      layout: name === DFC ? "transform" : name === SPLIT ? "split" : "normal",
      highres_image: true,
      image_status: "highres_scan",
      mana_cost: "{2}{U}",
      cmc: 3,
      type_line: "Creature — Bench Fixture",
      oracle_text:
        "Flying\nWhen this creature enters, draw a card, then discard a card. Activated abilities of artifacts your opponents control cost {1} more to activate.",
      colors: ["U"],
      color_identity: ["U"],
      keywords: ["Flying"],
      legalities: LEGAL,
      games: digital ? ["arena", "mtgo"] : ["paper", "mtgo"],
      reserved: false,
      foil: true,
      nonfoil: true,
      finishes: ["nonfoil", "foil"],
      digital,
      rarity: "rare",
      artist: "Bench Artist",
      set,
      set_name: `Bench Set ${set.toUpperCase()}`,
      collector_number: number,
      border_color: "black",
      frame: "2015",
      prices: { usd: "1.23", usd_foil: "4.56", eur: "1.01", tix: "0.02" },
      related_uris: {
        gatherer: "https://gatherer.wizards.com/",
        edhrec: "https://edhrec.com/",
      },
      purchase_uris: {
        tcgplayer: "https://www.tcgplayer.com/",
        cardmarket: "https://www.cardmarket.com/",
        cardhoarder: "https://www.cardhoarder.com/",
      },
    };
    if (name === DFC) {
      const [front, back] = name.split(" // ");
      card.card_faces = [
        {
          name: front,
          image_uris: cardImages(set, front, number, digital),
        },
        { name: back, image_uris: cardImages(set, back, number, digital) },
      ];
    } else {
      card.image_uris = cardImages(set, name, number, digital);
      if (name === SPLIT)
        card.card_faces = name.split(" // ").map((face) => ({ name: face }));
    }
    return card;
  });
}

const term = (q, key) => {
  const m = q.match(
    new RegExp(`(?:^|[\\s(])${key}:("(?:[^"\\\\]|\\\\.)*"|\\S+)`, "i")
  );
  if (!m) return undefined;
  const raw = m[1].replace(/\)$/, "");
  return raw.startsWith('"') ? JSON.parse(raw) : raw;
};

function searchCards(q) {
  const names = [...q.matchAll(/!("(?:[^"\\]|\\.)*")/g)].map((m) =>
    JSON.parse(m[1])
  );
  if (!names.length || (names.length > 1 && !/\bor\b/i.test(q))) return [];
  const lang = (q.match(/\blang:(\w+)/i)?.[1] ?? "en").toLowerCase();
  if (lang !== "en" && lang !== "any") return [];
  const set = term(q, "set") ?? term(q, "s") ?? term(q, "e");
  const number = term(q, "number") ?? term(q, "cn");
  const paper = /\bgame:paper\b/i.test(q);
  const unique = (q.match(/\bunique:(\w+)/i)?.[1] ?? "cards").toLowerCase();
  const found = [];
  for (const name of [...new Set(names)].sort()) {
    const matches = printingsOf(name).filter(
      (c) =>
        (!set || c.set === String(set).toLowerCase()) &&
        (!number || c.collector_number === String(number)) &&
        (!paper || !c.digital)
    );
    found.push(...(unique === "cards" ? matches.slice(0, 1) : matches));
  }
  return found;
}

// Every name the deck can ask for, so lookups by id or by set and collector
// number can find a card without its name, as Scryfall does.
const KNOWN_NAMES = [
  ...generic,
  ...printed.map((c) => c.name),
  SPLIT,
  DFC,
  "Hit It!",
  "Elas il-Kor, Sadistic Pilgrim",
  "Island",
  "Mountain",
];

function lookup(identifier) {
  const pool = identifier.name
    ? printingsOf(identifier.name)
    : KNOWN_NAMES.flatMap(printingsOf);
  if (identifier.id) return pool.find((c) => c.id === identifier.id);
  if (!identifier.name && !(identifier.set && identifier.collector_number))
    return undefined;
  return pool.find(
    (c) =>
      (!identifier.set || c.set === String(identifier.set).toLowerCase()) &&
      (!identifier.collector_number ||
        c.collector_number === String(identifier.collector_number))
  );
}

const SETS = ["dig", "new", "alt", "old"].map((code) => ({
  object: "set",
  code,
  name: `Bench Set ${code.toUpperCase()}`,
  released_at: "2020-01-01",
  digital: code === "dig",
}));

function emulator() {
  const stats = {
    limited: 0,
    other: 0,
    violations: [],
    cdn: 0,
    drive: 0,
    preflight: 0,
  };
  const recent = { limited: [], other: [] };
  const LIMIT = { limited: 2, other: 10 };
  // Small tolerance for timer jitter between the page and this process.
  const WINDOW_MS = 950;
  const admit = (kind, path) => {
    const now = Date.now();
    const list = recent[kind];
    while (list.length && now - list[0] >= WINDOW_MS) list.shift();
    stats[kind]++;
    if (list.length >= LIMIT[kind]) {
      stats.violations.push(`${kind} ${path}`);
      return false;
    }
    list.push(now);
    return true;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Accept, Accept-Charset, Accept-Language, Authorization, Cache-Control, Content-Language, Content-Type, DNT, Host, If-Modified-Since, Keep-Alive, Origin, Referer, User-Agent, X-Requested-With",
    "Access-Control-Max-Age": "300",
  };
  const json = (route, body, status = 200) =>
    route.fulfill({
      status,
      headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
  const notFound = { object: "error", code: "not_found", status: 404 };

  async function api(route) {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      stats.preflight++;
      return route.fulfill({ status: 204, headers: CORS });
    }
    const kind = /^\/cards\/(search|named|random|collection)$/.test(
      url.pathname
    )
      ? "limited"
      : "other";
    if (!admit(kind, url.pathname)) {
      await sleep(LATENCY.other);
      return json(
        route,
        { object: "error", code: "rate_limited", status: 429 },
        429
      );
    }
    await sleep(LATENCY[kind]);
    if (url.pathname === "/sets")
      return json(route, { object: "list", has_more: false, data: SETS });
    if (url.pathname === "/cards/autocomplete") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      return json(route, {
        object: "catalog",
        data: generic.filter((n) => n.toLowerCase().includes(q)).slice(0, 20),
      });
    }
    if (url.pathname === "/cards/search") {
      const all = searchCards(url.searchParams.get("q") ?? "");
      const page = Number(url.searchParams.get("page") ?? 1);
      const data = all.slice((page - 1) * 175, page * 175);
      if (!data.length) return json(route, notFound, 404);
      const next = new URL(url);
      next.searchParams.set("page", String(page + 1));
      return json(route, {
        object: "list",
        total_cards: all.length,
        has_more: page * 175 < all.length,
        ...(page * 175 < all.length ? { next_page: next.toString() } : {}),
        data,
      });
    }
    if (url.pathname === "/cards/named") {
      const name =
        url.searchParams.get("exact") ?? url.searchParams.get("fuzzy");
      const card = name
        ? lookup({ name, set: url.searchParams.get("set") ?? undefined })
        : undefined;
      return card ? json(route, card) : json(route, notFound, 404);
    }
    if (url.pathname === "/cards/collection" && request.method() === "POST") {
      let identifiers;
      try {
        identifiers = JSON.parse(request.postData() ?? "{}").identifiers;
      } catch {
        identifiers = null;
      }
      if (!Array.isArray(identifiers) || identifiers.length > 75)
        return json(
          route,
          { object: "error", code: "bad_request", status: 422 },
          422
        );
      const data = [],
        not_found = [];
      for (const identifier of identifiers) {
        const card = lookup(identifier);
        if (card) data.push(card);
        else not_found.push(identifier);
      }
      return json(route, { object: "list", not_found, data });
    }
    return json(route, notFound, 404);
  }

  return { stats, api, CORS, sleep };
}

// ----------------------------------------------------------------- helpers

function startPreview() {
  const child = spawn(
    "npm",
    [
      "run",
      "preview",
      "--prefix",
      "client",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(PORT),
      "--strictPort",
    ],
    { cwd: root, detached: true, stdio: "ignore" }
  );
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Preview server did not start on ${BASE}`);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// True once enough sheet previews have rendered: at least `count` in the
// whole document, or, for sheet `index`, every card there that has artwork.
function rendered([index, count]) {
  const root =
    index === null ? document : document.querySelectorAll(".proxy-page")[index];
  if (!root) return false;
  const done = [...root.querySelectorAll(".sortable-card img")].filter(
    (img) =>
      img.complete &&
      img.naturalWidth > 0 &&
      /^(blob:|data:)/.test(img.currentSrc || img.src)
  ).length;
  if (count !== null) return done >= count;
  const want = [...root.querySelectorAll(".sortable-card")].filter(
    (card) => !card.textContent.includes("No artwork found")
  ).length;
  return done >= want;
}

async function waitFor(page, fn, arg) {
  await page.waitForFunction(fn, arg, { polling: 25, timeout: TIMEOUT });
}

async function readDeck(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("proxxied-storage");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const store = db
            .transaction("zustand-store")
            .objectStore("zustand-store");
          const deck = store.get("proxxied:cards:v7");
          store.transaction.oncomplete = () => {
            db.close();
            const state = deck.result?.state;
            resolve(
              (state?.cards ?? []).map((c) => ({
                name: c.name,
                set: c.set,
                number: c.number,
                imageUrls: c.imageUrls,
                original: state.originalSelectedImages?.[c.uuid],
              }))
            );
          };
        };
      })
  );
}

function checkDeck(cards, problems) {
  if (cards.length !== CARD_COUNT)
    problems.push(`deck has ${cards.length} cards, expected ${CARD_COUNT}`);
  cards.forEach((card, i) => {
    const want = EXPECTED_NAMES[i];
    if (card.name !== want)
      problems.push(`card ${i + 1} is "${card.name}", expected "${want}"`);
    const urls = card.imageUrls ?? [];
    if (want === UNKNOWN) {
      if (urls.length) problems.push(`${UNKNOWN} should have no artwork`);
      return;
    }
    if (!urls.length) return problems.push(`${want} has no artwork`);
    if (urls.some((u) => !u.startsWith("https://cards.scryfall.io/png/")))
      problems.push(`${want} uses a non-PNG or foreign image: ${urls[0]}`);
    if (urls.some((u) => u.includes("/digital/")))
      problems.push(`${want} uses a digital-only printing`);
    if (card.original !== urls[0])
      problems.push(`${want} original is not its first face`);
    const fixed = printed.find((c) => c.name === want);
    if (fixed && (card.set !== "alt" || card.number !== fixed.number))
      problems.push(
        `${want} should be alt #${fixed.number}, got ${card.set} #${card.number}`
      );
    if (setOnly.includes(want) && card.set !== "old")
      problems.push(`${want} should be from set old, got ${card.set}`);
    if (want === DFC && urls.length !== 2)
      problems.push(`${DFC} should have 2 faces, got ${urls.length}`);
    if (want === SPLIT && urls.length !== 1)
      problems.push(`${SPLIT} should have 1 image, got ${urls.length}`);
  });
}

async function initialJsGzipKb(page) {
  const files = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((e) => new URL(e.name))
      .filter(
        (u) =>
          u.origin === location.origin && /\.(js|css|mjs)$/.test(u.pathname)
      )
      .map((u) => u.pathname)
  );
  let bytes = 0;
  for (const file of new Set(files))
    bytes += gzipSync(await readFile(join(root, "client/dist", file)), {
      level: 9,
    }).length;
  return bytes / 1024;
}

async function exportFile(page, button) {
  const dialog = page.getByRole("dialog", { name: "Export", exact: true });
  if (!(await dialog.isVisible()))
    await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download", { timeout: TIMEOUT });
  const started = Date.now();
  await dialog.getByRole("button", { name: button, exact: true }).click();
  const file = await download;
  const ms = Date.now() - started;
  return { ms, bytes: await readFile(await file.path()) };
}

// -------------------------------------------------------------- scenarios

let lastPage;

async function mainRun(browser) {
  const em = emulator();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const fixtures = await Promise.all(
    [
      "arasta.png",
      "elas-il-kor.png",
      "fireball.png",
      "hit-it.png",
      "white-border-lightning-bolt.png",
    ].map((f) => readFile(join(benchRoot, "tests/fixtures", f)))
  );
  await context.route("https://api.scryfall.com/**", em.api);
  await context.route("https://cards.scryfall.io/**", async (route) => {
    em.stats.cdn++;
    await em.sleep(LATENCY.cdn);
    route.fulfill({
      status: 200,
      headers: { ...em.CORS, "Content-Type": "image/png" },
      body: fixtures[hash(route.request().url()) % fixtures.length],
    });
  });
  const problems = [];
  const errors = [];
  const page = await context.newPage();
  lastPage = page;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    // Scryfall answers a search with no match with 404, which Chromium logs.
    if (
      msg.type() === "error" &&
      !msg.text().startsWith("Failed to load resource")
    )
      errors.push(`console: ${msg.text()}`);
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const m = {};

  let t = Date.now();
  await page.goto(BASE);
  await page
    .getByLabel("Decklist", { exact: true })
    .waitFor({ timeout: TIMEOUT });
  m.load_ms = Date.now() - t;
  m.initial_js_gzip_kb = await initialJsGzipKb(page);

  await page.getByLabel("Decklist", { exact: true }).fill(DECK);
  t = Date.now();
  await page.getByRole("button", { name: "Add to deck", exact: true }).click();
  await waitFor(
    page,
    (n) => document.querySelectorAll(".sortable-card").length >= n,
    CARD_COUNT
  );
  m.import_ms = Date.now() - t;
  await waitFor(page, rendered, [null, SHEET_SIZE]);
  m.first_sheet_ms = Date.now() - t;

  // Scroll through every sheet until each card with artwork is rendered.
  t = Date.now();
  const sheets = await page.locator(".proxy-page").count();
  for (let i = 0; i < sheets; i++) {
    const sheet = page.locator(".proxy-page").nth(i);
    await sheet.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await waitFor(page, rendered, [i, null]);
  }
  m.browse_all_ms = Date.now() - t;

  await page.waitForFunction(
    () => document.body.textContent.includes("Saved in this browser"),
    null,
    { timeout: TIMEOUT }
  );
  checkDeck(await readDeck(page), problems);
  // Export refuses a deck with a card that has no artwork.
  await page
    .getByRole("button", { name: `Remove one ${UNKNOWN}`, exact: true })
    .click();
  await waitFor(
    page,
    (n) => document.querySelectorAll(".sortable-card").length === n,
    CARD_COUNT - 1
  );

  // Changing the bleed re-renders every visible preview.
  await page
    .locator(".proxy-page")
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  const before = await page.evaluate(() =>
    [
      ...document
        .querySelectorAll(".proxy-page")[0]
        .querySelectorAll(".sortable-card img"),
    ].map((img) => img.src)
  );
  const region = page.getByRole("navigation", { name: "Workspace regions" });
  if (await region.isVisible())
    await region
      .getByRole("button", { name: "Print setup", exact: true })
      .click();
  const bleed = page.locator("#bleed");
  const current = Number(await bleed.inputValue());
  t = Date.now();
  await bleed.fill(String(current === 2 ? 1 : 2));
  await bleed.press("Tab");
  await waitFor(
    page,
    (old) => {
      const imgs = [
        ...document
          .querySelectorAll(".proxy-page")[0]
          .querySelectorAll(".sortable-card img"),
      ];
      return (
        imgs.length === old.length &&
        imgs.every(
          (img, i) =>
            img.src !== old[i] &&
            img.complete &&
            img.naturalWidth > 0 &&
            /^(blob:|data:)/.test(img.src)
        )
      );
    },
    before
  );
  m.rerender_ms = Date.now() - t;

  const zip = await exportFile(page, "Download original images · ZIP");
  m.zip_ms = zip.ms;
  const zipFiles = Object.keys((await JSZip.loadAsync(zip.bytes)).files);
  if (zipFiles.length < 70)
    problems.push(`ZIP has ${zipFiles.length} files, expected at least 70`);

  let peak = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const { metrics } = await cdp.send("Performance.getMetrics");
      const heap = metrics.find((x) => x.name === "JSHeapUsedSize")?.value ?? 0;
      peak = Math.max(peak, heap);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  const pdf = await exportFile(page, "Export fronts PDF");
  sampling = false;
  await sampler;
  m.pdf_ms = pdf.ms;
  m.pdf_peak_heap_mb = peak / 1024 / 1024;
  const pages = (await PDFDocument.load(pdf.bytes)).getPageCount();
  const wantPages = Math.ceil((CARD_COUNT - 1) / SHEET_SIZE);
  if (pages !== wantPages)
    problems.push(`PDF has ${pages} pages, expected ${wantPages}`);

  if (em.stats.violations.length)
    problems.push(
      `broke Scryfall's rate limit ${em.stats.violations.length} times (${em.stats.violations[0]})`
    );
  if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
  await context.close();
  return { metrics: m, problems, stats: em.stats };
}

async function mpcRun(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const lotus = await readFile(
    join(benchRoot, "tests/fixtures/mpc-simple-lotus.png")
  );
  let drive = 0;
  await context.route("**/api/cards/images/front?**", async (route) => {
    drive++;
    await new Promise((r) => setTimeout(r, LATENCY.drive));
    route.fulfill({ status: 200, contentType: "image/png", body: lotus });
  });
  await context.route("https://**", (route) => route.abort());
  const page = await context.newPage();
  await page.goto(BASE);
  await page
    .getByLabel("Decklist", { exact: true })
    .waitFor({ timeout: TIMEOUT });
  const ids = Array.from(
    { length: 18 },
    (_, i) => `benchdriveid${String(i).padStart(4, "0")}`
  );
  const xml = `<order><fronts>${ids
    .map(
      (id, i) =>
        `<card><id>${id}</id><slots>${i}</slots><name>MPC ${i}</name></card>`
    )
    .join("")}</fronts><cardback>benchdriveback00</cardback></order>`;
  const t = Date.now();
  await page.getByLabel("MPCFill XML or text").setInputFiles({
    name: "deck.xml",
    mimeType: "text/xml",
    buffer: Buffer.from(xml),
  });
  await waitFor(page, rendered, [null, SHEET_SIZE]);
  const ms = Date.now() - t;
  await context.close();
  return { ms, drive };
}

// ------------------------------------------------------------------- main

async function main() {
  const server = startPreview();
  const stop = () => {
    try {
      process.kill(-server.pid);
    } catch {
      /* already stopped */
    }
  };
  process.on("exit", stop);
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const samples = Object.fromEntries(METRICS.map((k) => [k, []]));
    const problems = [];
    const stats = [];
    for (let run = 1; run <= RUNS; run++) {
      const main = await mainRun(browser).catch(async (error) => {
        await mkdir(join(benchRoot, ".artifacts/perf"), { recursive: true });
        await lastPage
          ?.screenshot({ path: join(benchRoot, ".artifacts/perf/failure.png") })
          .catch(() => {});
        throw error;
      });
      const mpc = await mpcRun(browser);
      for (const [k, v] of Object.entries(main.metrics)) samples[k].push(v);
      samples.mpc_first_sheet_ms.push(mpc.ms);
      problems.push(...main.problems.map((p) => `run ${run}: ${p}`));
      stats.push({
        ...main.stats,
        violations: main.stats.violations.length,
        drive: mpc.drive,
      });
      console.error(
        `run ${run}/${RUNS}: ` +
          METRICS.map((k) => `${k}=${Math.round(samples[k].at(-1))}`).join(" ")
      );
    }
    await browser.close();
    const medians = Object.fromEntries(
      METRICS.map((k) => [k, Math.round(median(samples[k]) * 10) / 10])
    );
    const result = {
      date: new Date().toISOString(),
      runs: RUNS,
      valid: problems.length === 0,
      problems,
      medians,
      samples,
      requests: stats,
    };
    if (args.baseline) {
      const baseline = JSON.parse(
        await readFile(resolve(args.baseline), "utf8")
      );
      const ratios = Object.fromEntries(
        SCORED.filter((k) => baseline.medians?.[k] > 0 && medians[k] > 0).map(
          (k) => [
            k,
            Math.round((baseline.medians[k] / medians[k]) * 1000) / 1000,
          ]
        )
      );
      const values = Object.values(ratios);
      result.ratios = ratios;
      result.score = result.valid
        ? Math.round(
            Math.exp(
              values.reduce((s, v) => s + Math.log(v), 0) / values.length
            ) * 1000
          ) / 1000
        : null;
    }
    if (args.out) {
      await mkdir(dirname(resolve(args.out)), { recursive: true });
      await writeFile(resolve(args.out), JSON.stringify(result, null, 2));
    }
    console.log(
      JSON.stringify(
        {
          valid: result.valid,
          score: result.score,
          medians,
          ratios: result.ratios,
          problems,
        },
        null,
        2
      )
    );
    process.exitCode = result.valid ? 0 : 1;
  } finally {
    stop();
  }
}

await main();
