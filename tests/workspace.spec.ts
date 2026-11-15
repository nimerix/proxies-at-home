import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const requireClient = createRequire(
  new URL("../client/package.json", import.meta.url)
);
const { PDFDocument, PDFArray, PDFName, decodePDFRawStream } =
  requireClient("pdf-lib");
const JSZip = requireClient("jszip");
import {
  addCardsDialog,
  confirmDialog,
  exportDialog,
  openAddCards,
  openAdvanced,
  openExport,
  setTwoSided,
  showRegion,
} from "./ui";
const fixture = await readFile(
  new URL("../client/public/cardback.png", import.meta.url)
);

// The card search answers this name with no artwork, like Scryfall for a typo.
const UNKNOWN_CARD = "Not A Real Card";
// The card search answers this name with 24 printings, one per set.
const MANY_PRINTS = "Many Prints";
// Returned among Lightning Bolt's printings.
const OTHER_CARD = "Emeritus of Conflict // Lightning Bolt";
const SETS = [
  { code: "c21", name: "Commander 2021", released_at: "2021-04-23" },
  { code: "cmr", name: "Commander Legends", released_at: "2020-11-20" },
  ...Array.from({ length: 24 }, (_, i) => ({
    code: `m${String(i + 1).padStart(2, "0")}`,
    name: `Many Prints Set ${i + 1}`,
    released_at: `${2000 + i}-06-01`,
  })),
];

// Scryfall's API and image CDN allow cross-origin reads; the mocks must too.
const CORS = { "Access-Control-Allow-Origin": "*" };
const CARD_CDN = "https://cards.scryfall.io/";
// Full card images; thumbnails are the "-normal.jpg" variants.
const isCardImage = (url: string) =>
  url.startsWith(CARD_CDN) && url.endsWith(".png");
const searchTerm = (q: string, key: string): string | undefined => {
  const match = q.match(new RegExp(`(?:^|\\s)${key}("(?:[^"\\\\]|\\\\.)*")`));
  return match ? JSON.parse(match[1]) : undefined;
};
function scryfallCard(name: string, set: string, number = "123") {
  const image = (png: string) => ({
    png,
    normal: png.replace(".png", "-normal.jpg"),
  });
  const front = `${CARD_CDN}${encodeURIComponent(name)}-${set}.png`;
  return name === "Day // Night"
    ? {
        name,
        set,
        collector_number: number,
        card_faces: [
          { name: "Day", image_uris: image(front) },
          { name: "Night", image_uris: image(`${CARD_CDN}night-${set}.png`) },
        ],
      }
    : { name, set, collector_number: number, image_uris: image(front) };
}

async function mockCards(page: Page) {
  await page.route(`${CARD_CDN}**`, (route) =>
    route.fulfill({ contentType: "image/png", body: fixture, headers: CORS })
  );
  await page.route("**/api/cards/images/front?**", (route) =>
    route.fulfill({ contentType: "image/png", body: fixture })
  );
  await page.route("https://api.scryfall.com/**", (route) => {
    const url = new URL(route.request().url());
    const reply = (json: unknown, status = 200) =>
      route.fulfill({ status, json, headers: CORS });
    if (url.pathname === "/sets") return reply({ data: SETS });
    if (url.pathname === "/cards/autocomplete")
      return reply({ data: ["Sol Ring", "Fire // Ice", "Day // Night"] });
    if (url.pathname !== "/cards/search")
      return reply({ object: "error" }, 404);
    const q = url.searchParams.get("q") ?? "";
    // One exact name, or several joined with "or".
    const names = [...q.matchAll(/!("(?:[^"\\]|\\.)*")/g)].map(
      (match) => JSON.parse(match[1]) as string
    );
    const cards = names.flatMap((name) => {
      // Like Scryfall for a typo: no card matches.
      if (name === UNKNOWN_CARD) return [];
      const found = q.includes("unique:prints")
        ? (name === MANY_PRINTS
            ? SETS.slice(2).map((set) => set.code)
            : ["c21", "cmr"]
          ).map((set) => scryfallCard(name, set))
        : [
            scryfallCard(
              name,
              searchTerm(q, "set:") ?? "c21",
              searchTerm(q, "number:")
            ),
          ];
      // Like Scryfall, a name search can return a different card that
      // contains the name.
      if (q.includes("unique:prints") && name === "Lightning Bolt")
        found.push({
          name: OTHER_CARD,
          set: "cmr",
          collector_number: "7",
          image_uris: { png: `${CARD_CDN}emeritus-sos.png` },
        } as ReturnType<typeof scryfallCard>);
      // Sorted by name, that card comes before Lightning Bolt itself.
      else if (name === "Lightning Bolt")
        found.unshift({
          name: OTHER_CARD,
          set: "sos",
          collector_number: "113",
          card_faces: [
            {
              name: "Emeritus of Conflict",
              image_uris: { png: `${CARD_CDN}emeritus-sos.png` },
            },
            {
              name: "Lightning Bolt",
              image_uris: { png: `${CARD_CDN}bolt-face-sos.png` },
            },
          ],
        } as unknown as ReturnType<typeof scryfallCard>);
      return found;
    });
    if (!cards.length) return reply({ object: "error" }, 404);
    return reply({ data: cards, has_more: false });
  });
}
async function addDeck(page: Page, deck: string) {
  await openAddCards(page);
  await page.getByLabel("Decklist", { exact: true }).fill(deck);
  await page.getByRole("button", { name: "Add to deck", exact: true }).click();
  // A successful add closes the form: the dialog closes, or the empty
  // Deck panel turns into the deck list.
  await expect(page.getByLabel("Decklist", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function saveDownload(page: Page, button: string) {
  await openExport(page);
  const download = page.waitForEvent("download");
  await exportDialog(page)
    .getByRole("button", { name: button, exact: true })
    .click();
  const result = await download;
  const path = await result.path();
  return readFile(path!);
}
async function pdfInfo(bytes: Buffer) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page: any) => {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref: any) => pdf.context.lookup(ref))
        : [contents];
    const text = streams
      .map((stream: any) =>
        Buffer.from(decodePDFRawStream(stream).decode()).toString()
      )
      .join("\n");
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [],
      positions: number[][] = [],
      sources: string[] = [];
    const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"));
    for (const command of text.split("\n").map((s: string) => s.trim())) {
      if (command === "q") stack.push([...matrix]);
      else if (command === "Q") matrix = stack.pop()!;
      else if (command.endsWith(" cm")) {
        const [A, B, C, D, E, F] = command.split(" ").map(Number);
        const [a, b, c, d, e, f] = matrix;
        matrix = [
          a * A + c * B,
          b * A + d * B,
          a * C + c * D,
          b * C + d * D,
          a * E + c * F + e,
          b * E + d * F + f,
        ];
      } else if (/^\/Image[^\s]* Do$/.test(command)) {
        positions.push([...matrix]);
        const image = xobjects?.lookup(PDFName.of(command.slice(1, -3)));
        sources.push(
          createHash("sha1")
            .update(image?.contents ?? "")
            .digest("hex")
        );
      }
    }
    return {
      width: page.getWidth(),
      height: page.getHeight(),
      images: positions.length,
      positions,
      sources,
      text,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await mockCards(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Add cards", exact: true })
  ).toBeVisible();
});

// Whether the Deck panel, the mat and Print setup are each shown.
const visibleRegions = (page: Page) =>
  Promise.all(
    ["#deck-panel", "#preview-panel", "#print-panel"].map((id) =>
      page.locator(id).isVisible()
    )
  );

async function expectNoAxeViolations(page: Page, where: string) {
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    axe.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    where
  ).toEqual([]);
}

test("responsive workspace and accessible empty states", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      const regions =
        width < 760
          ? (["Deck", "Sheets", "Print setup"] as const)
          : width < 1180
            ? (["Deck", "Print setup"] as const)
            : [null];
      for (const region of regions) {
        if (region) await showRegion(page, region);
        const [deck, mat, print] = await visibleRegions(page);
        const where = `${scheme} at ${width}px, ${region ?? "all"}`;
        if (width >= 1180)
          expect([deck, mat, print], where).toEqual([true, true, true]);
        else if (width >= 760) {
          expect(mat, where).toBe(true);
          expect(Number(deck) + Number(print), where).toBe(1);
        } else
          expect(Number(deck) + Number(mat) + Number(print), where).toBe(1);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true);
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(
          axe.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          }))
        ).toEqual([]);
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({
    path: `.artifacts/${test.info().project.name}/workspace-empty.png`,
    fullPage: true,
  });
});

test("uploaded fronts and backs, settings, duplicate, and reset survive reload correctly", async ({
  page,
}) => {
  await page.getByLabel("Upload card images", { exact: true }).setInputFiles({
    name: "My custom card.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  await expect(
    page
      .getByRole("button", {
        name: "My custom card, change artwork",
        exact: true,
      })
      .getByRole("img")
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Upload back for My custom card" })
    .click();
  await page.getByLabel("Back image for My custom card").setInputFiles({
    name: "back.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  await page.getByRole("button", { name: "Landscape", exact: true }).click();
  await setTwoSided(page, true);
  await page.getByLabel("Custom cardback", { exact: true }).setInputFiles({
    name: "global.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  await expect(
    page.getByRole("img", { name: "Your custom cardback" })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Landscape", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .getByRole("button", {
        name: "My custom card, change artwork",
        exact: true,
      })
      .getByRole("img")
  ).toBeVisible();
  await page.getByRole("button", { name: "Backs", exact: true }).click();
  await expect(
    page
      .getByRole("button", {
        name: "My custom card, change artwork",
        exact: true,
      })
      .getByRole("img")
  ).toBeVisible();
  await page.getByLabel("Actions for My custom card", { exact: true }).click();
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "My custom card, change artwork",
      exact: true,
    })
  ).toHaveCount(2);
  await setTwoSided(page, true);
  await expect(
    page.getByRole("img", { name: "Your custom cardback" })
  ).toBeVisible();
  const resetAppData = page.getByRole("button", {
    name: "Reset app data",
    exact: true,
  });
  await resetAppData.focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("dialog");
  await expect(
    confirm.getByRole("heading", {
      name: "Delete everything saved in this browser?",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    confirm.getByRole("button", { name: "Cancel", exact: true })
  ).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(resetAppData).toBeFocused();
  await expect(
    page.getByRole("button", {
      name: "My custom card, change artwork",
      exact: true,
    })
  ).toHaveCount(2);
  await resetAppData.click();
  await confirmDialog(page, "Delete saved data");
  await expect(
    page.getByText("Saved workspace cleared.", { exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "No cards yet", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Portrait", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
});

test("exact printings, custom-grid second page actions and artwork replacement", async ({
  page,
}) => {
  await page.getByLabel("Columns", { exact: true }).fill("2");
  await page.getByLabel("Rows", { exact: true }).fill("2");
  await addDeck(
    page,
    "1 Sol Ring (c21)\n1 Sol Ring (cmr)\n1 Fire // Ice\n1 Counterspell\n1 Day // Night"
  );
  await page
    .getByRole("button", { name: "Day // Night, change artwork", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page
      .getByRole("button", {
        name: "Day // Night, change artwork",
        exact: true,
      })
      .getByRole("img")
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Day // Night, change artwork", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Choose Day // Night, Night, Commander Legends, CMR #123, 2020",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Flip Day // Night", exact: true })
    .click();
  await expect(
    page
      .getByRole("button", {
        name: "Day // Night, change artwork",
        exact: true,
      })
      .getByRole("img")
  ).toBeVisible();
  const zipSources: string[] = [];
  page.on("request", (request) => {
    if (isCardImage(request.url())) zipSources.push(request.url());
  });
  const zipBytes = await saveDownload(page, "Download original images · ZIP");
  const zip = await JSZip.loadAsync(zipBytes);
  expect(Object.keys(zip.files)).toHaveLength(5);
  expect(zipSources).toContain(
    "https://cards.scryfall.io/Day%20%2F%2F%20Night-cmr.png"
  );
  expect(zipSources).not.toContain("https://cards.scryfall.io/night-cmr.png");
  const deck = await saveDownload(page, "Download list");
  expect(deck.toString()).toContain("Sol Ring (c21)");
  expect(deck.toString()).toContain("Sol Ring (cmr)");
  await page
    .getByRole("button", { name: "Day // Night, change artwork", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Replace with a different card", exact: true })
    .click();
  await page.getByLabel("Find a card", { exact: true }).fill("Fire // Ice");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Choose Fire // Ice, Commander Legends, CMR #123, 2020",
      exact: true,
    })
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Choose Fire // Ice, Commander Legends, CMR #123, 2020",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Fire // Ice, change artwork",
      exact: true,
    })
  ).toHaveCount(2);
});

for (const count of [1, 2, 3, 10, 11])
  test(`PDF fronts, backs and collated partial sheets for ${count} cards`, async ({
    page,
  }) => {
    await addDeck(page, `${count} Sol Ring`);
    await setTwoSided(page, true);
    const sheets = Math.ceil(count / 9);
    for (const back of [false, true]) {
      const pages = await pdfInfo(
        await saveDownload(
          page,
          back ? "Export backs PDF" : "Export fronts PDF"
        )
      );
      expect(pages).toHaveLength(sheets);
      expect(pages.map((p: any) => p.images)).toEqual(
        Array.from({ length: sheets }, (_, i) => Math.min(9, count - i * 9))
      );
      expect(pages[0].width).toBeCloseTo(612);
      expect(pages[0].height).toBeCloseTo(792);
      for (const [sheet, pdfPage] of pages.entries()) {
        const size = Math.min(9, count - sheet * 9);
        const slots = Array.from({ length: size }, (_, i) =>
          back ? Math.floor(i / 3) * 3 + 2 - (i % 3) : i
        ).sort((a, b) => a - b);
        pdfPage.positions.forEach((position: number[], i: number) => {
          const slot = slots[i],
            pt = 72 / 25.4;
          expect(position[0]).toBeCloseTo(67 * pt);
          expect(position[3]).toBeCloseTo(92 * pt);
          expect(position[4]).toBeCloseTo((7.45 + (slot % 3) * 67) * pt);
          expect(position[5]).toBeCloseTo(
            (279.4 - 1.7 - (Math.floor(slot / 3) + 1) * 92) * pt
          );
        });
      }
    }
    await openExport(page);
    await page
      .getByLabel("One file, fronts and backs alternating", { exact: true })
      .check();
    const collated = await pdfInfo(
      await saveDownload(page, "Export collated PDF")
    );
    expect(collated).toHaveLength(sheets * 2);
    expect(collated.reduce((sum: number, p: any) => sum + p.images, 0)).toBe(
      count * 2
    );
  });

test("MPC XML preserves slot order and backs and produces a collated PDF", async ({
  page,
}) => {
  const xml =
    "<order><fronts><card><id>abcdefghijkl</id><slots>1</slots><name>Second</name></card><card><id>mnopqrstuvwx</id><slots>0</slots><name>First</name></card></fronts><backs><card><id>zyxwvutsrqpo</id><slots>0</slots></card></backs></order>";
  await page.getByLabel("MPCFill XML or text").setInputFiles({
    name: "deck.xml",
    mimeType: "text/xml",
    buffer: Buffer.from(xml),
  });
  const cards = page.getByRole("button", { name: /change artwork/ });
  await expect(cards).toHaveCount(2);
  expect(await cards.first().getAttribute("aria-label")).toContain("First");
  await page.getByRole("button", { name: "Backs", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "First, change artwork" }).getByRole("img")
  ).toBeVisible();
  await setTwoSided(page, true);
  await openExport(page);
  await page
    .getByLabel("One file, fronts and backs alternating", { exact: true })
    .check();
  expect(
    await pdfInfo(await saveDownload(page, "Export collated PDF"))
  ).toHaveLength(2);
});

test("mixed duplex export, keyboard actions, mobile preview and artwork dialog", async ({
  page,
}) => {
  await addDeck(page, "1 Sol Ring\n1 Day // Night");
  await page.getByRole("button", { name: "Landscape", exact: true }).click();
  await openAddCards(page);
  await page.getByLabel("Upload card images", { exact: true }).setInputFiles({
    name: "Custom.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  await page.getByLabel("Back image for Custom").setInputFiles({
    name: "Custom back.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  await setTwoSided(page, true);
  await page.getByLabel("Custom cardback", { exact: true }).setInputFiles({
    name: "Global.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  await openExport(page);
  await page
    .getByLabel("One file, fronts and backs alternating", { exact: true })
    .check();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations
  ).toEqual([]);
  const pdf = await pdfInfo(await saveDownload(page, "Export collated PDF"));
  expect(pdf.map((p: any) => p.images)).toEqual([3, 3]);
  expect(pdf[0].width).toBeCloseTo(792);
  expect(pdf[0].height).toBeCloseTo(612);
  const art = page.getByRole("button", {
    name: "Sol Ring, change artwork",
    exact: true,
  });
  await art.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Choose Sol Ring, Commander Legends, CMR #123, 2020",
      exact: true,
    })
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations
  ).toEqual([]);
  await page.screenshot({
    path: `.artifacts/${test.info().project.name}/artwork-picker.png`,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(art).toBeFocused();
  const actions = page.getByLabel("Actions for Sol Ring", { exact: true });
  await actions.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Move later", exact: true }).focus();
  await page.keyboard.press("Enter");
  expect(
    await page
      .getByRole("button", { name: /change artwork/ })
      .first()
      .getAttribute("aria-label")
  ).toContain("Day // Night");
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: `.artifacts/${test.info().project.name}/workspace-cards.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await showRegion(page, "Sheets");
  await expect(page.locator(".card-control:visible")).toHaveCount(0);
  const mobileActions = page.getByLabel("Actions for Day // Night", {
    exact: true,
  });
  await mobileActions.click();
  const menuPanel = page.locator(".card-menu[open] > div");
  await expect(
    page.getByRole("button", { name: "Flip card", exact: true })
  ).toBeVisible();
  await expect
    .poll(async () => {
      const box = await menuPanel.boundingBox();
      const scroller = await page.locator(".sheet-scroller").boundingBox();
      return (
        !!box &&
        !!scroller &&
        box.x >= scroller.x &&
        box.y >= scroller.y &&
        box.x + box.width <= scroller.x + scroller.width &&
        box.y + box.height <= scroller.y + scroller.height
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "Flip card", exact: true }).click();
  await expect(menuPanel).toHaveCount(0);
  await page.getByLabel("Actions for Custom", { exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Upload back image", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "Mobile back.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  await page.getByLabel("Actions for Custom", { exact: true }).click();
  await page.getByRole("button", { name: "Move earlier", exact: true }).click();
  await expect(menuPanel).toHaveCount(0);
  await expect(
    page.getByLabel("Actions for Custom", { exact: true })
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: /change artwork/ }).nth(1)
  ).toHaveAttribute("aria-label", "Custom, change artwork");
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations
  ).toEqual([]);
  await page.screenshot({
    path: `.artifacts/${test.info().project.name}/workspace-mobile.png`,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: `.artifacts/${test.info().project.name}/workspace-mobile-dark.png`,
  });
});

test("failed exports are visible and cancelling an import keeps the existing deck", async ({
  page,
}) => {
  await addDeck(page, "1 Sol Ring");
  await expect(
    page
      .getByRole("button", { name: "Sol Ring, change artwork", exact: true })
      .getByRole("img")
  ).toBeVisible();
  await page.route(`${CARD_CDN}**`, (route) =>
    route.fulfill({ status: 502, body: "Image unavailable", headers: CORS })
  );
  await openExport(page);
  await exportDialog(page)
    .getByRole("button", { name: "Export fronts PDF", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Export stopped" })
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let started!: () => void, release!: () => void;
  const requestRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(
    "https://api.scryfall.com/cards/search?**",
    async (route) => {
      started();
      await requestRelease;
      await route.abort();
    }
  );
  await openAddCards(page);
  await page.getByLabel("Decklist", { exact: true }).fill("1 Counterspell");
  await page.getByRole("button", { name: "Add to deck", exact: true }).click();
  await requestStarted;
  await page
    .getByRole("button", { name: "Cancel import", exact: true })
    .click();
  release();
  // The progress dialog closes; the Add cards dialog stays open with the list.
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(addCardsDialog(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /change artwork/ })
  ).toHaveCount(1);
  await expect(page.getByLabel("Decklist", { exact: true })).toHaveValue(
    "1 Counterspell"
  );
});

test("legacy workspace migrates without losing print settings", async ({
  page,
}) => {
  await page.evaluate(() => {
    localStorage.setItem(
      "proxxied:cards:v6",
      JSON.stringify({
        version: 6,
        state: {
          cards: [
            {
              uuid: "legacy",
              name: "Legacy card",
              imageUrls: ["/cardback.png"],
              isUserUpload: false,
            },
          ],
          originalSelectedImages: { legacy: "/cardback.png" },
        },
      })
    );
    localStorage.setItem(
      "proxxied:layout-settings:v2",
      JSON.stringify({
        version: 1,
        state: {
          pageSizePreset: "A4",
          pageOrientation: "landscape",
          bleedEdgeWidth: 1,
          columns: 2,
          rows: 2,
        },
      })
    );
  });
  await page.reload();
  await expect(
    page
      .getByRole("button", { name: "Legacy card, change artwork", exact: true })
      .getByRole("img")
  ).toBeVisible();
  await expect(page.getByLabel("Paper size", { exact: true })).toHaveValue(
    "A4"
  );
  await expect(
    page.getByRole("button", { name: "Landscape", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Bleed (mm)", { exact: true })).toHaveValue("1");
  expect(
    await page.evaluate(() => localStorage.getItem("proxxied:cards:v6"))
  ).toBeNull();
});

test("a failed deck save stays visible when settings save successfully", async ({
  page,
}) => {
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === "proxxied:cards:v7")
        throw new DOMException("Device full", "QuotaExceededError");
      return put.call(this, value, key);
    };
  });
  await addDeck(page, "1 Sol Ring");
  await expect(
    page.getByRole("alert").filter({ hasText: "Changes could not be saved" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Landscape", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Landscape", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("alert").filter({ hasText: "Changes could not be saved" })
  ).toBeVisible();
});

test("collated batching keeps front and back pairs together", async ({
  page,
}) => {
  await addDeck(page, "10 Sol Ring");
  await setTwoSided(page, true);
  await openExport(page);
  await page
    .getByLabel("One file, fronts and backs alternating", { exact: true })
    .check();
  await page.getByLabel("Split PDF into smaller files").check();
  await page.getByLabel("Pages per file", { exact: true }).fill("3");
  const downloads: import("@playwright/test").Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await exportDialog(page)
    .getByRole("button", { name: "Export collated PDF", exact: true })
    .click();
  await expect.poll(() => downloads.length).toBe(2);
  for (const [index, download] of downloads.entries()) {
    const pages = await pdfInfo(await readFile((await download.path())!));
    expect(pages.map((p: any) => p.images)).toEqual(
      index === 0 ? [9, 9] : [1, 1]
    );
  }
});

test("MPC default backs are retained and conflicting slots are rejected", async ({
  page,
}) => {
  const source =
    "<order><fronts><card><id>abcdefghijkl</id><slots>0</slots><name>Default back card</name></card></fronts><cardback>mnopqrstuvwx</cardback></order>";
  await page.getByLabel("MPCFill XML or text").setInputFiles({
    name: "deck.xml",
    mimeType: "text/xml",
    buffer: Buffer.from(source),
  });
  const request = page.waitForRequest((r) =>
    r.url().includes("/front?id=mnopqrstuvwx")
  );
  await page.getByRole("button", { name: "Backs", exact: true }).click();
  await request;
  const conflict = source.replace(
    "</fronts>",
    "<card><id>zyxwvutsrqpo</id><slots>0</slots></card></fronts>"
  );
  await openAddCards(page);
  await page.getByLabel("MPCFill XML or text").setInputFiles({
    name: "bad.xml",
    mimeType: "text/xml",
    buffer: Buffer.from(conflict),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "more than one front image" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /change artwork/ })
  ).toHaveCount(1);
});

test("MPC preview and PDF retain the same physical bleed and artwork", async ({
  page,
}) => {
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 690;
    canvas.height = 940;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 690, 940);
    ctx.fillStyle = "blue";
    ctx.fillRect(30, 30, 630, 880);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Upload MPC images", { exact: true }).setInputFiles({
    name: "Bleed.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  });
  const preview = page
    .getByRole("button", { name: "Bleed, change artwork", exact: true })
    .getByRole("img");
  await expect(preview).toBeVisible();
  for (const bleed of [0, 1, 2, 3, 3.5, 5]) {
    const previous = await preview.getAttribute("src");
    await page.getByLabel("Bleed (mm)", { exact: true }).fill(String(bleed));
    await page.getByLabel("Bleed (mm)", { exact: true }).press("Enter");
    await expect(preview).toBeVisible();
    await expect(preview).not.toHaveAttribute("src", previous!);
    const bytes = await saveDownload(page, "Export fronts PDF");
    const pdf = await PDFDocument.load(bytes);
    const stream = pdf.context
      .enumerateIndirectObjects()
      .map((entry: any) => entry[1])
      .find(
        (object: any) =>
          object.dict?.get(PDFName.of("Subtype"))?.toString() === "/Image"
      );
    const src = `data:image/jpeg;base64,${Buffer.from(stream.contents).toString("base64")}`;
    for (const image of [await preview.getAttribute("src"), src]) {
      const result = await page.evaluate(async (source) => {
        const img = new Image();
        img.src = source!;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(
          0,
          Math.floor(img.height / 2),
          img.width,
          1
        ).data;
        let firstBlue = -1,
          lastBlue = -1;
        for (let x = 0; x < img.width; x++)
          if (pixels[x * 4 + 2] > 200 && pixels[x * 4] < 50) {
            if (firstBlue < 0) firstBlue = x;
            lastBlue = x;
          }
        return {
          width: img.width,
          left: firstBlue / img.width,
          right: (img.width - 1 - lastBlue) / img.width,
        };
      }, image);
      expect(result.left).toBeCloseTo(bleed / (63 + 2 * bleed), 2);
      expect(result.right).toBeCloseTo(bleed / (63 + 2 * bleed), 2);
    }
  }
});

async function embeddedJpeg(bytes: Buffer) {
  const pdf = await PDFDocument.load(bytes);
  const stream = pdf.context
    .enumerateIndirectObjects()
    .map((entry: any) => entry[1])
    .find(
      (object: any) =>
        object.dict?.get(PDFName.of("Subtype"))?.toString() === "/Image"
    );
  return `data:image/jpeg;base64,${Buffer.from(stream.contents).toString("base64")}`;
}

test("shadow controls update actual front and custom-back preview and PDF pixels", async ({
  page,
}) => {
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 630;
    c.height = 880;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, 630, 880);
    ctx.fillStyle = "#5096be";
    ctx.fillRect(4, 4, 622, 872);
    return c.toDataURL().split(",")[1];
  });
  const image = {
    name: "Rim test.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  };
  await page
    .getByLabel("Upload card images", { exact: true })
    .setInputFiles(image);
  const preview = page
    .getByRole("button", { name: "Rim test, change artwork", exact: true })
    .getByRole("img");
  await expect(preview).toBeVisible();
  await openAdvanced(page, "Artwork edges");
  const setInset = async (value: string) => {
    const old = await preview.getAttribute("src");
    await page.getByLabel("Shadow removal (mm)", { exact: true }).fill(value);
    await page
      .getByLabel("Shadow removal (mm)", { exact: true })
      .press("Enter");
    await expect(preview).not.toHaveAttribute("src", old!);
  };
  await setInset("0");
  await setTwoSided(page, true);
  await page
    .getByLabel("Custom cardback", { exact: true })
    .setInputFiles(image);
  await page.getByRole("button", { name: "Backs", exact: true }).click();
  await expect(preview).toBeVisible();
  const edge = async (src: string) =>
    page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return Array.from(
        ctx.getImageData(
          Math.round((img.width * 2) / 67),
          Math.floor(img.height / 2),
          1,
          1
        ).data
      );
    }, src);
  const oldColor = await edge((await preview.getAttribute("src"))!);
  expect(oldColor[0]).toBeGreaterThan(230);
  expect(oldColor[1]).toBeLessThan(25);
  expect(oldColor[2]).toBeGreaterThan(230);
  await setInset("0.5");
  for (const src of [
    (await preview.getAttribute("src"))!,
    await embeddedJpeg(await saveDownload(page, "Export backs PDF")),
  ]) {
    const color = await edge(src);
    [80, 150, 190, 255].forEach((v, i) =>
      expect(Math.abs(v - color[i])).toBeLessThanOrEqual(6)
    );
  }
  await page.getByRole("button", { name: "Fronts", exact: true }).click();
  await expect(preview).toBeVisible();
  for (const src of [
    (await preview.getAttribute("src"))!,
    await embeddedJpeg(await saveDownload(page, "Export fronts PDF")),
  ]) {
    const color = await edge(src);
    [80, 150, 190, 255].forEach((v, i) =>
      expect(Math.abs(v - color[i])).toBeLessThanOrEqual(6)
    );
  }
});

test("scan cleanup removes opaque corners in preview and PDFs at every export DPI", async ({
  page,
}) => {
  const source = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 630;
    canvas.height = 880;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, 630, 880);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, 630, 880, 25);
    ctx.clip();
    for (const [x, y, color] of [
      [0, 0, "#f4d354"],
      [315, 0, "#2c7fbe"],
      [0, 440, "#c83c36"],
      [315, 440, "#0e0f10"],
    ] as const) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 315, 440);
    }
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
    return canvas.toDataURL().split(",")[1];
  });
  await page.getByLabel("Upload card images", { exact: true }).setInputFiles({
    name: "Corner probe.png",
    mimeType: "image/png",
    buffer: Buffer.from(source, "base64"),
  });
  const preview = page
    .getByRole("button", { name: "Corner probe, change artwork", exact: true })
    .getByRole("img");
  await expect(preview).toBeVisible();
  async function checkCorners(src: string, dpi: number) {
    const result = await page.evaluate(
      async ({ src, dpi }) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        const b = Math.round((2 * dpi) / 25.4);
        const pixels = [];
        for (const [x, y] of [
          [0, 0],
          [image.width - 1, 0],
          [0, image.height - 1],
          [image.width - 1, image.height - 1],
          [b - 1, b - 1],
          [b, b],
        ])
          pixels.push(Array.from(ctx.getImageData(x, y, 1, 1).data));
        return { width: image.width, height: image.height, pixels };
      },
      { src, dpi }
    );
    expect(result.width).toBe(
      Math.round((63 * dpi) / 25.4) + 2 * Math.round((2 * dpi) / 25.4)
    );
    expect(result.height).toBe(
      Math.round((88 * dpi) / 25.4) + 2 * Math.round((2 * dpi) / 25.4)
    );
    const colors = [
      [244, 211, 84],
      [44, 127, 190],
      [200, 60, 54],
      [0, 0, 0],
      [244, 211, 84],
      [244, 211, 84],
    ];
    result.pixels.forEach((p, i) => {
      expect(p[3]).toBe(255);
      colors[i].forEach((c, j) =>
        expect(Math.abs(p[j] - c)).toBeLessThanOrEqual(5)
      );
    });
  }
  await checkCorners((await preview.getAttribute("src"))!, 200);
  for (const dpi of [600, 900, 1200]) {
    await openExport(page);
    await page
      .getByLabel("Resolution", { exact: true })
      .selectOption(String(dpi));
    await checkCorners(
      await embeddedJpeg(await saveDownload(page, "Export fronts PDF")),
      dpi
    );
  }
  await openAdvanced(page, "Artwork edges");
  const original = await preview.getAttribute("src");
  await page.getByLabel("Image edges", { exact: true }).selectOption("square");
  await expect(preview).not.toHaveAttribute("src", original!);
  await expect(
    page.getByLabel("Shadow removal (mm)", { exact: true })
  ).toBeDisabled();
  await page.getByLabel("Image edges", { exact: true }).selectOption("scan");
  await page.getByLabel("Shadow removal (mm)", { exact: true }).fill("0.4");
  await page.getByLabel("Shadow removal (mm)", { exact: true }).press("Enter");
  await expect(
    page.getByText("Saved in this browser", { exact: true })
  ).toBeVisible();
  await page.reload();
  await openAdvanced(page, "Artwork edges");
  await expect(
    page.getByLabel("Shadow removal (mm)", { exact: true })
  ).toHaveValue("0.4");
  await expect(page.getByLabel("Image edges", { exact: true })).toHaveValue(
    "scan"
  );
});

for (const name of [
  "fireball",
  "hit-it",
  "elas-il-kor",
  "white-border-lightning-bolt",
]) {
  test(`${name} border behavior reaches the preview and printed PDF`, async ({
    page,
  }) => {
    await page
      .getByLabel("Upload card images", { exact: true })
      .setInputFiles(
        new URL(`./fixtures/${name}.png`, import.meta.url).pathname
      );
    const preview = page
      .getByRole("button", {
        name: `${name.replaceAll("-", " ")}, change artwork`,
        exact: true,
      })
      .getByRole("img");
    await expect(preview).toBeVisible();
    const previous = await preview.getAttribute("src");
    await page.getByLabel("Bleed (mm)", { exact: true }).fill("5");
    await page.getByLabel("Bleed (mm)", { exact: true }).press("Enter");
    await expect(preview).not.toHaveAttribute("src", previous!);
    const edgeTone = async (src: string) =>
      page.evaluate(
        async ({ src, name }) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          const c = document.createElement("canvas");
          c.width = image.width;
          c.height = image.height;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(image, 0, 0);
          const p = ctx.getImageData(
            Math.floor(image.width * 0.4),
            name === "elas-il-kor" ? image.height - 4 : 0,
            Math.floor(image.width * 0.2),
            4
          ).data;
          let min = 255,
            max = 0;
          for (let i = 0; i < p.length; i++)
            if (i % 4 !== 3) {
              min = Math.min(min, p[i]);
              max = Math.max(max, p[i]);
            }
          return { min, max };
        },
        { src, name }
      );
    for (const src of [
      (await preview.getAttribute("src"))!,
      await embeddedJpeg(await saveDownload(page, "Export fronts PDF")),
    ]) {
      const tone = await edgeTone(src);
      if (name === "white-border-lightning-bolt")
        expect(tone.min).toBeGreaterThanOrEqual(253);
      else expect(tone.max).toBeLessThanOrEqual(2);
    }
    if (name === "fireball") {
      await openAdvanced(page, "Artwork edges");
      const before = await preview.getAttribute("src");
      await page
        .getByLabel("Border bleed", { exact: true })
        .selectOption("mirror");
      await expect(preview).not.toHaveAttribute("src", before!);
      for (const src of [
        (await preview.getAttribute("src"))!,
        await embeddedJpeg(await saveDownload(page, "Export fronts PDF")),
      ])
        expect((await edgeTone(src)).max).toBeGreaterThan(80);
      await page.reload();
      await openAdvanced(page, "Artwork edges");
      await expect(
        page.getByLabel("Border bleed", { exact: true })
      ).toHaveValue("mirror");
      await expect(preview).toBeVisible();
      expect(
        (await edgeTone((await preview.getAttribute("src"))!)).max
      ).toBeGreaterThan(80);
      await page
        .getByLabel("Border bleed", { exact: true })
        .selectOption("auto");
      await expect
        .poll(
          async () => (await edgeTone((await preview.getAttribute("src"))!)).max
        )
        .toBeLessThanOrEqual(2);
    }
  });
}

test("large uploaded previews run serially in workers while the UI stays responsive", async ({
  page,
}) => {
  const source = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 4200;
    c.height = 5867;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#5096be";
    ctx.fillRect(0, 0, c.width, c.height);
    const src = c.toDataURL().split(",")[1];
    c.width = c.height = 0;
    const NativeWorker = window.Worker;
    let running = 0;
    (window as any).workerEvidence = {
      maxRunning: 0,
      started: 0,
      terminated: 0,
      ticks: 0,
    };
    const evidence = (window as any).workerEvidence;
    setInterval(() => {
      if (running) evidence.ticks++;
    }, 10);
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        running++;
        evidence.started++;
        evidence.maxRunning = Math.max(evidence.maxRunning, running);
      }
      terminate() {
        running--;
        evidence.terminated++;
        super.terminate();
      }
    };
    return src;
  });
  await page.getByLabel("Upload card images", { exact: true }).setInputFiles(
    [1, 2, 3].map((i) => ({
      name: `Large${i}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(source, "base64"),
    }))
  );
  for (const i of [1, 2, 3])
    await expect(
      page
        .getByRole("button", { name: `Large${i}, change artwork`, exact: true })
        .getByRole("img")
    ).toBeVisible();
  const evidence = await page.evaluate(() => (window as any).workerEvidence);
  expect(evidence.maxRunning).toBe(1);
  expect(evidence.started).toBe(1);
  expect(evidence.terminated).toBe(0);
  expect(evidence.ticks).toBeGreaterThan(2);
});

test("per-card bleed overrides preserve mixed-deck previews, PDF variants and saved choices", async ({
  page,
}) => {
  await page
    .getByLabel("Upload card images", { exact: true })
    .setInputFiles(
      new URL("./fixtures/fireball.png", import.meta.url).pathname
    );
  const buttons = page.getByRole("button", {
    name: "fireball, change artwork",
    exact: true,
  });
  await expect(buttons.getByRole("img")).toBeVisible();
  await buttons.first().click({ button: "right" });
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(buttons).toHaveCount(2);
  await page.getByLabel("Bleed (mm)", { exact: true }).fill("5");
  await page.getByLabel("Bleed (mm)", { exact: true }).press("Enter");
  await expect(buttons.last().getByRole("img")).toBeVisible();
  await buttons.first().click();
  await page.getByText("Bleed for this card", { exact: true }).click();
  await expect(page.getByLabel("Bleed result", { exact: true })).toHaveText(
    "Detected edges: top: black; right: black; bottom: black; left: black."
  );
  await expect(
    page
      .getByLabel("Card border bleed", { exact: true })
      .getByRole("option", { selected: true })
  ).toHaveText("Use print setting · Auto");
  await page
    .getByLabel("Card border bleed", { exact: true })
    .selectOption("mirror");
  await page
    .getByLabel("Card image corner radius", { exact: true })
    .selectOption("3.2");
  await page
    .getByLabel("Card shadow removal", { exact: true })
    .selectOption("1");
  await page
    .getByLabel("Card image edges", { exact: true })
    .selectOption("square");
  await expect(
    page.getByLabel("Card shadow removal", { exact: true })
  ).toBeDisabled();
  const tone = async (src: string) =>
    page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const c = document.createElement("canvas");
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const p = ctx.getImageData(
        Math.floor(c.width * 0.4),
        0,
        Math.floor(c.width * 0.2),
        4
      ).data;
      let max = 0;
      for (let i = 0; i < p.length; i++)
        if (i % 4 !== 3) max = Math.max(max, p[i]);
      return max;
    }, src);
  await expect
    .poll(async () => {
      const src = await page
        .getByRole("img", { name: "Card bleed preview", exact: true })
        .getAttribute("src");
      return src ? await tone(src) : 0;
    })
    .toBeGreaterThan(80);
  await expect(page.getByLabel("Bleed result", { exact: true })).toHaveText(
    "All edges continue the artwork."
  );
  await page
    .getByRole("button", { name: "Close artwork picker", exact: true })
    .click();
  await expect
    .poll(async () => {
      const src = await buttons.last().getByRole("img").getAttribute("src");
      return src ? await tone(src) : 255;
    })
    .toBeLessThanOrEqual(2);
  const pdf = await PDFDocument.load(
    await saveDownload(page, "Export fronts PDF")
  );
  const streams = pdf.context
    .enumerateIndirectObjects()
    .map((entry: any) => entry[1])
    .filter(
      (o: any) => o.dict?.get(PDFName.of("Subtype"))?.toString() === "/Image"
    );
  expect(streams).toHaveLength(2); // Same source, distinct processing options.
  const tones = await Promise.all(
    streams.map((s: any) =>
      tone(
        `data:image/jpeg;base64,${Buffer.from(s.contents).toString("base64")}`
      )
    )
  );
  expect(Math.min(...tones)).toBeLessThanOrEqual(2);
  expect(Math.max(...tones)).toBeGreaterThan(80);
  await expect(
    page.getByText("Saved in this browser", { exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(buttons.first().getByRole("img")).toBeVisible();
  expect(
    await tone((await buttons.first().getByRole("img").getAttribute("src"))!)
  ).toBeGreaterThan(80);
  expect(
    await tone((await buttons.last().getByRole("img").getAttribute("src"))!)
  ).toBeLessThanOrEqual(2);
  await buttons.first().click();
  await page.getByText("Bleed for this card", { exact: true }).click();
  await expect(
    page.getByLabel("Card border bleed", { exact: true })
  ).toHaveValue("mirror");
  await expect(
    page.getByLabel("Card image edges", { exact: true })
  ).toHaveValue("square");
  await expect(
    page.getByLabel("Card image corner radius", { exact: true })
  ).toHaveValue("3.2");
  await expect(
    page.getByLabel("Card shadow removal", { exact: true })
  ).toHaveValue("1");
});

test("per-card bleed preview keeps updating while viewing backs", async ({
  page,
}) => {
  await page
    .getByLabel("Upload card images", { exact: true })
    .setInputFiles(
      new URL("./fixtures/fireball.png", import.meta.url).pathname
    );
  const card = page.getByRole("button", {
    name: "fireball, change artwork",
    exact: true,
  });
  await expect(card.getByRole("img")).toBeVisible();
  await page.getByRole("button", { name: "Backs", exact: true }).click();
  await expect(card.getByRole("img")).toBeVisible();
  await card.click();
  await page.getByText("Bleed for this card", { exact: true }).click();
  const preview = page.getByRole("img", {
    name: "Card bleed preview",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await page
    .getByLabel("Card border bleed", { exact: true })
    .selectOption("mirror");
  await expect(preview).toBeVisible();
  await expect
    .poll(async () => {
      const previewSource = await preview.getAttribute("src");
      const cardSource = await card.getByRole("img").getAttribute("src");
      return !!previewSource && previewSource === cardSource;
    })
    .toBe(true);
  await page
    .getByLabel("Card shadow removal", { exact: true })
    .selectOption("1");
  await expect(preview).toBeVisible();
  await expect
    .poll(async () => {
      const previewSource = await preview.getAttribute("src");
      const cardSource = await card.getByRole("img").getAttribute("src");
      return !!previewSource && previewSource === cardSource;
    })
    .toBe(true);
});

test("Arasta's four rounded corners have local artwork instead of scan wedges", async ({
  page,
}) => {
  await page
    .getByLabel("Upload card images", { exact: true })
    .setInputFiles(new URL("./fixtures/arasta.png", import.meta.url).pathname);
  const preview = page
    .getByRole("button", { name: "arasta, change artwork", exact: true })
    .getByRole("img");
  await expect(preview).toBeVisible();
  const pdf = await embeddedJpeg(await saveDownload(page, "Export fronts PDF"));
  for (const [label, src] of [
    ["preview", await preview.getAttribute("src")],
    ["pdf", pdf],
  ]) {
    const result = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src!;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const b = Math.round((img.width * 2) / 67);
      const corners = [
        [b, b],
        [img.width - b - 1, b],
        [b, img.height - b - 1],
        [img.width - b - 1, img.height - b - 1],
      ];
      const radius = Math.max(2, Math.round((img.width / 67) * 0.5));
      return {
        pixels: corners.map(([x, y]) => {
          const patch = ctx.getImageData(
            x - radius,
            y - radius,
            2 * radius + 1,
            2 * radius + 1
          ).data;
          const mean = [0, 0, 0];
          for (let i = 0; i < patch.length; i += 4)
            for (let c = 0; c < 3; c++)
              mean[c] += patch[i + c] / (patch.length / 4);
          return mean;
        }),
        png: canvas.toDataURL(),
      };
    }, src);
    // The old top-left sample filled both bottom corners with pale yellow.
    for (const p of result.pixels.slice(2))
      expect(Math.max(...p.slice(0, 3))).toBeLessThan(35);
    // Average a physical patch: the top-right artwork contains legitimate ink
    // lines, so an individual dark pixel is not evidence of a scan shadow.
    const [topLeft, topRight] = result.pixels;
    expect(topLeft[0] + topLeft[1] + topLeft[2]).toBeGreaterThan(600);
    // The helmet corner is orange/brown, not the pale yellow previously
    // borrowed from the top-left corner. Dark helmet ink must be preserved.
    expect(topRight[0]).toBeGreaterThan(topRight[1] * 1.2);
    expect(topRight[1]).toBeGreaterThan(topRight[2] * 1.15);
    await test.info().attach(`arasta-${label}`, {
      body: Buffer.from(result.png.split(",")[1], "base64"),
      contentType: "image/png",
    });
    await mkdir(".artifacts/bleed", { recursive: true });
    await writeFile(
      `.artifacts/bleed/arasta-${label}-${test.info().project.name}.png`,
      Buffer.from(result.png.split(",")[1], "base64")
    );
  }
});

test("blocked browser storage can run a temporary workspace without writing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      value: {
        open() {
          throw new DOMException("Site storage is disabled", "SecurityError");
        },
      },
    });
  });
  await page.reload();
  await expect(page.getByText(/Site storage is disabled/)).toBeVisible();
  await page
    .getByRole("button", { name: "Continue without saving", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Temporary workspace" })
  ).toBeVisible();
  await addDeck(page, "1 Sol Ring");
  expect(
    (await pdfInfo(await saveDownload(page, "Export fronts PDF")))[0].images
  ).toBe(1);
  await expect(
    page.getByText("Temporary workspace · saving disabled", { exact: true })
  ).toBeVisible();
});

test("corrupt legacy data can be explicitly cleared without trapping startup", async ({
  page,
}) => {
  await page.evaluate(() =>
    localStorage.setItem("proxxied:cards:v6", "{broken")
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Continue without saving", exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Delete saved data and start fresh",
      exact: true,
    })
    .click();
  await confirmDialog(page, "Delete saved data");
  await expect(
    page.getByRole("heading", { name: "Add cards", exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("proxxied:cards:v6"))
  ).toBeNull();
  await addDeck(page, "1 Sol Ring");
  await expect(
    page.getByText("Saved in this browser", { exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sol Ring, change artwork", exact: true })
  ).toBeVisible();
});

test("grid preferences survive orientation and number fields support editing", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Landscape", exact: true }).click();
  await expect(page.getByLabel("Columns", { exact: true })).toHaveValue("4");
  await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "Portrait", exact: true }).click();
  await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("3");
  const columns = page.getByLabel("Columns", { exact: true });
  await columns.fill("");
  await expect(columns).toHaveValue("");
  await columns.pressSequentially("2");
  await columns.press("Enter");
  await expect(columns).toHaveValue("2");
  await page.getByRole("button", { name: "Landscape", exact: true }).click();
  await page.getByRole("button", { name: "Portrait", exact: true }).click();
  await expect(columns).toHaveValue("2");
  await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("3");
  const width = page.getByLabel("Width (px)", { exact: true });
  await width.fill("");
  await width.pressSequentially("1.2");
  await width.press("Enter");
  await expect(width).toHaveValue("1.2");
  await width.fill("3");
  await width.press("Escape");
  await expect(width).toHaveValue("1.2");
  await page
    .getByRole("button", { name: "Fit maximum cards", exact: true })
    .click();
  await expect(columns).toHaveValue("3");
});

test("artwork picker uses direct normal thumbnails and keeps original PNG selection", async ({
  page,
}) => {
  await addDeck(page, "1 Sol Ring");
  const art = page.getByRole("button", {
    name: "Sol Ring, change artwork",
    exact: true,
  });
  await expect(art.getByRole("img")).toBeVisible();
  const requests: string[] = [];
  page.on("request", (req) => requests.push(req.url()));
  await art.click();
  const choice = page.getByRole("button", {
    name: "Choose Sol Ring, Commander Legends, CMR #123, 2020",
    exact: true,
  });
  await expect(choice.getByRole("img")).toHaveAttribute(
    "src",
    "https://cards.scryfall.io/Sol%20Ring-cmr-normal.jpg"
  );
  await expect
    .poll(() =>
      requests.some(
        (url) => url === "https://cards.scryfall.io/Sol%20Ring-cmr-normal.jpg"
      )
    )
    .toBe(true);
  expect(requests.some(isCardImage)).toBe(false);
  await choice.click();
  await expect(art.getByRole("img")).toBeVisible();
  await saveDownload(page, "Download original images · ZIP");
  expect(requests).toContain(`${CARD_CDN}Sol%20Ring-cmr.png`);
});

test("editing the uploaded source file does not change originals or reloads", async ({
  page,
}) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const folder = await mkdtemp(join(tmpdir(), "proxxied-original-"));
  try {
    const source = join(folder, "Changing card.png");
    await writeFile(source, fixture);
    await page
      .getByLabel("Upload card images", { exact: true })
      .setInputFiles(source);
    await expect(
      page
        .getByRole("button", {
          name: "Changing card, change artwork",
          exact: true,
        })
        .getByRole("img")
    ).toBeVisible();
    await expect(
      page.getByText("Saved in this browser", { exact: true })
    ).toBeVisible();
    await writeFile(source, "source changed after upload");
    for (let attempt = 0; attempt < 2; attempt++) {
      const zip = await JSZip.loadAsync(
        await saveDownload(page, "Download original images · ZIP")
      );
      const saved = await zip
        .file(Object.keys(zip.files)[0])!
        .async("nodebuffer");
      expect(saved.equals(fixture)).toBe(true);
      if (attempt === 0) {
        await page.reload();
        await expect(
          page
            .getByRole("button", {
              name: "Changing card, change artwork",
              exact: true,
            })
            .getByRole("img")
        ).toBeVisible();
      }
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("failed per-card bleed previews show an error and can be retried", async ({
  page,
}) => {
  await addDeck(page, "1 Sol Ring");
  const card = page.getByRole("button", {
    name: "Sol Ring, change artwork",
    exact: true,
  });
  await expect(card.getByRole("img")).toBeVisible();
  await card.click();
  await page.getByText("Bleed for this card", { exact: true }).click();
  let fail = true;
  await page.route(`${CARD_CDN}**`, (route) =>
    fail
      ? route.fulfill({ status: 503, body: "Unavailable", headers: CORS })
      : route.fulfill({
          contentType: "image/png",
          body: fixture,
          headers: CORS,
        })
  );
  await page
    .getByLabel("Card border bleed", { exact: true })
    .selectOption("mirror");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not prepare the bleed preview" })
  ).toBeVisible();
  await expect(
    page.getByText("Preparing bleed preview…", { exact: true })
  ).toHaveCount(0);
  fail = false;
  await page
    .getByRole("button", { name: "Retry bleed preview", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Card bleed preview", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry bleed preview", exact: true })
  ).toHaveCount(0);
});

for (const [tone, shadow, suggested] of [
  [240, 0.5, 0.6],
  [30, 0.4, 0.5],
]) {
  test(`shadow guidance repairs two edges of a ${tone === 240 ? "white" : "black"} frame`, async ({
    page,
  }) => {
    const source = await page.evaluate(
      ({ tone, shadow }) => {
        const c = document.createElement("canvas");
        c.width = 1260;
        c.height = 1760;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = "#cc8822";
        ctx.fillRect(40, 40, 1180, 1680);
        ctx.fillStyle = "#8c8c8c";
        ctx.fillRect(0, 0, shadow * 20, c.height);
        ctx.fillRect(0, 0, c.width, shadow * 20);
        return c.toDataURL().split(",")[1];
      },
      { tone, shadow }
    );
    await page.getByLabel("Upload card images", { exact: true }).setInputFiles({
      name: "Shadow.png",
      mimeType: "image/png",
      buffer: Buffer.from(source, "base64"),
    });
    const card = page.getByRole("button", {
      name: "Shadow, change artwork",
      exact: true,
    });
    await expect(card.getByRole("img")).toBeVisible();
    await card.click();
    await page.getByText("Bleed for this card", { exact: true }).click();
    await expect(
      page.getByText(
        `Possible edge shadow. Try ${suggested} mm shadow removal.`,
        { exact: true }
      )
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Use suggested shadow removal",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Card shadow removal", { exact: true })
    ).toHaveValue(String(suggested));
    await expect(
      page.getByRole("img", { name: "Card bleed preview", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Use suggested shadow removal",
        exact: true,
      })
    ).toHaveCount(0);
    const treatment = tone === 240 ? "white" : "black";
    await expect(page.getByLabel("Bleed result", { exact: true })).toHaveText(
      `Detected edges: top: ${treatment}; right: ${treatment}; bottom: ${treatment}; left: ${treatment}.`
    );
  });
}

async function savedUploads(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ fronts: number; backs: number }>((resolve, reject) => {
        const open = indexedDB.open("proxxied-storage");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const store = db
            .transaction("zustand-store")
            .objectStore("zustand-store");
          const deck = store.get("proxxied:cards:v7");
          const keys = store.getAllKeys();
          store.transaction.oncomplete = () => {
            db.close();
            const stored = new Set(keys.result);
            const count = (
              files?: Record<string, { __proxxiedFile: string }>
            ) =>
              Object.values(files ?? {}).filter((file) =>
                stored.has(file.__proxxiedFile)
              ).length;
            resolve({
              fronts: count(deck.result?.state.uploadedFiles),
              backs: count(deck.result?.state.uploadedBackFiles),
            });
          };
        };
      })
  );
}

test("undo restores an uploaded card and its back across reload", async ({
  page,
}) => {
  const logo = await readFile(
    new URL("../client/public/logo.png", import.meta.url)
  );
  await page.getByLabel("Upload card images", { exact: true }).setInputFiles({
    name: "Kept card.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  const art = page.getByRole("button", {
    name: "Kept card, change artwork",
    exact: true,
  });
  await expect(art.getByRole("img")).toBeVisible();
  await page.getByLabel("Back image for Kept card").setInputFiles({
    name: "Kept back.png",
    mimeType: "image/png",
    buffer: logo,
  });
  await expect(page.getByText(/^Back image added\./)).toBeVisible();
  await expect(
    page.getByText("Saved in this browser", { exact: true })
  ).toBeVisible();
  await expect.poll(() => savedUploads(page)).toEqual({ fronts: 1, backs: 1 });
  await setTwoSided(page, true);
  const imageCounts = async () => [
    (await pdfInfo(await saveDownload(page, "Export fronts PDF"))).map(
      (p: any) => p.images
    ),
    (await pdfInfo(await saveDownload(page, "Export backs PDF"))).map(
      (p: any) => p.images
    ),
  ];
  const before = await imageCounts();
  expect(before).toEqual([[1], [1]]);
  for (const round of ["before reload", "after reload"]) {
    await page.getByLabel("Actions for Kept card", { exact: true }).click();
    await page
      .getByRole("button", { name: "Remove card", exact: true })
      .click();
    await expect(art).toHaveCount(0);
    await expect(
      page.getByText("Removed Kept card.", { exact: true })
    ).toBeVisible();
    await expect
      .poll(() => savedUploads(page), { message: round })
      .toEqual({ fronts: 0, backs: 0 });
    const notices = page.getByRole("region", { name: "Notifications" });
    await notices.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(notices.getByRole("button", { name: "Undo" })).toHaveCount(0);
    await expect(art.getByRole("img")).toBeVisible();
    await expect(
      page.getByText("Saved in this browser", { exact: true })
    ).toBeVisible();
    await expect
      .poll(() => savedUploads(page), { message: round })
      .toEqual({ fronts: 1, backs: 1 });
    await page.reload();
    await expect(art.getByRole("img")).toBeVisible();
    expect(await imageCounts()).toEqual(before);
  }
});

test("the undo on a removal notice undoes only that removal", async ({
  page,
}) => {
  await addDeck(page, "1 Sol Ring\n1 Island");
  const art = (name: string) =>
    page.getByRole("button", { name: `${name}, change artwork`, exact: true });
  await expect(art("Sol Ring").getByRole("img")).toBeVisible();
  await expect(art("Island").getByRole("img")).toBeVisible();
  for (const name of ["Sol Ring", "Island"]) {
    await page.getByLabel(`Actions for ${name}`, { exact: true }).click();
    await page
      .getByRole("button", { name: "Remove card", exact: true })
      .click();
    await expect(art(name)).toHaveCount(0);
  }
  const undo = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toHaveCount(1);
  await expect(
    page
      .getByRole("status")
      .filter({ has: page.getByRole("button", { name: "Undo", exact: true }) })
  ).toContainText("Removed Island.");
  await undo.click();
  await expect(art("Island").getByRole("img")).toBeVisible();
  await expect(art("Sol Ring")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    page.getByText("Undid: remove Sol Ring.", { exact: true })
  ).toBeVisible();
  await expect(art("Sol Ring").getByRole("img")).toBeVisible();
  await expect(art("Island").getByRole("img")).toBeVisible();
});

test("undo reverses a flip and an artwork change as whole actions", async ({
  page,
}) => {
  await addDeck(page, "1 Sol Ring\n1 Day // Night");
  const dayNight = page.getByRole("button", {
    name: "Day // Night, change artwork",
    exact: true,
  });
  const solRing = page.getByRole("button", {
    name: "Sol Ring, change artwork",
    exact: true,
  });
  await expect(dayNight.getByRole("img")).toBeVisible();
  await expect(solRing.getByRole("img")).toBeVisible();
  const requested: string[] = [];
  page.on("request", (request) => {
    if (isCardImage(request.url())) requested.push(request.url());
  });
  await page
    .getByRole("button", { name: "Flip Day // Night", exact: true })
    .click();
  await expect
    .poll(() => requested)
    .toContain("https://cards.scryfall.io/night-c21.png");
  await expect(dayNight.getByRole("img")).toBeVisible();
  requested.length = 0;
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    page.getByText("Undid: flip Day // Night.", { exact: true })
  ).toBeVisible();
  await expect
    .poll(() => requested)
    .toContain("https://cards.scryfall.io/Day%20%2F%2F%20Night-c21.png");
  await expect(dayNight.getByRole("img")).toBeVisible();
  expect(requested).not.toContain("https://cards.scryfall.io/night-c21.png");

  await solRing.click();
  await page
    .getByRole("button", {
      name: "Choose Sol Ring, Commander Legends, CMR #123, 2020",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(solRing.getByRole("img")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    page.getByText("Undid: change artwork for Sol Ring.", { exact: true })
  ).toBeVisible();
  await expect(solRing.getByRole("img")).toBeVisible();
  requested.length = 0;
  const zip = await JSZip.loadAsync(
    await saveDownload(page, "Download original images · ZIP")
  );
  expect(Object.keys(zip.files)).toHaveLength(2);
  expect(requested).toContain("https://cards.scryfall.io/Sol%20Ring-c21.png");
  expect(requested).not.toContain(
    "https://cards.scryfall.io/Sol%20Ring-cmr.png"
  );
});

test("undo while a preview is still rendering leaves the restored card intact", async ({
  page,
}) => {
  const logo = await readFile(
    new URL("../client/public/logo.png", import.meta.url)
  );
  await addDeck(page, "1 Sol Ring");
  const solRing = page.getByRole("button", {
    name: "Sol Ring, change artwork",
    exact: true,
  });
  const preview = solRing.getByRole("img");
  await expect(preview).toBeVisible();
  const originalPreview = await preview.getAttribute("src");
  const isChosenPrinting = (url: string) =>
    url === `${CARD_CDN}Sol%20Ring-cmr.png`;
  let started!: () => void, release!: () => void, settled!: () => void;
  const requestStarted = new Promise<void>((resolve) => (started = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const requestSettled = new Promise<void>((resolve) => (settled = resolve));
  for (const event of ["requestfinished", "requestfailed"] as const)
    page.on(event, (request) => {
      if (isChosenPrinting(request.url())) settled();
    });
  await page.route(`${CARD_CDN}**`, async (route) => {
    if (!isChosenPrinting(route.request().url())) return route.fallback();
    started();
    await released;
    await route
      .fulfill({ contentType: "image/png", body: logo, headers: CORS })
      .catch(() => {});
  });
  await solRing.click();
  await page
    .getByRole("button", {
      name: "Choose Sol Ring, Commander Legends, CMR #123, 2020",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await requestStarted;
  await expect(preview).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    page.getByText("Undid: change artwork for Sol Ring.", { exact: true })
  ).toBeVisible();
  await expect(preview).toHaveAttribute("src", originalPreview!);
  release();
  await requestSettled;
  // Give a late render of the discarded printing time to land if it were kept.
  await page.waitForTimeout(500);
  await expect(preview).toHaveAttribute("src", originalPreview!);
  await expect(page.getByRole("button", { name: /^Retry/ })).toHaveCount(0);
  await solRing.click();
  await expect(
    page.getByRole("button", {
      name: "Choose Sol Ring, Commander 2021, C21 #123, 2021",
      exact: true,
    })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", {
      name: "Choose Sol Ring, Commander Legends, CMR #123, 2020",
      exact: true,
    })
  ).toHaveAttribute("aria-pressed", "false");
});

test("the bottom bar never covers content on a phone", async ({ page }) => {
  await addDeck(page, "20 Sol Ring\n2 Counterspell\n1 Day // Night");
  const bar = page.getByRole("navigation", { name: "Workspace regions" });
  for (const [width, height] of [
    [390, 844],
    [320, 640],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(bar).toBeVisible();
    const barTop = (await bar.boundingBox())!.y;
    for (const [region, scroller] of [
      ["Deck", '.side-panel[data-panel="deck"]'],
      ["Sheets", ".sheet-scroller"],
      ["Print setup", '.side-panel[data-panel="print"]'],
    ] as const) {
      await showRegion(page, region);
      const bottom = await page.locator(scroller).evaluate(async (el) => {
        el.scrollTop = el.scrollHeight;
        await new Promise(requestAnimationFrame);
        const focusable = [
          ...el.querySelectorAll<HTMLElement>(
            "button, a[href], input, select, textarea, summary"
          ),
        ].filter((e) => e.getClientRects().length > 0);
        return focusable.at(-1)!.getBoundingClientRect().bottom;
      });
      expect(bottom, `${region} at ${width}px`).toBeLessThanOrEqual(barTop);
    }
    await openExport(page);
    await exportDialog(page)
      .getByRole("button", { name: "Copy list", exact: true })
      .click();
    const notice = page
      .getByRole("region", { name: "Notifications" })
      .locator(".notice")
      .last();
    await expect(notice).toBeVisible();
    const box = (await notice.boundingBox())!;
    expect(
      box.y + box.height,
      `notification at ${width}px`
    ).toBeLessThanOrEqual(barTop);
  }
});

test("controls stay clear of the screen's safe-area insets", async ({
  page,
}) => {
  await addDeck(page, "20 Sol Ring\n2 Counterspell\n1 Day // Night");
  // env(safe-area-inset-*) is 0 outside iOS, so stand in for an iPhone's insets.
  await page.addStyleTag({
    content:
      ":root { --safe-top: 0px; --safe-left: 47px; --safe-right: 47px; --safe-bottom: 21px; }",
  });
  const inset = { left: 47, right: 47, bottom: 21 };
  for (const [width, height] of [
    [844, 390],
    [1280, 800],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    const nav = page.getByRole("navigation", { name: "Workspace regions" });
    const floor = (await nav.isVisible())
      ? (await nav.boundingBox())!.y
      : height - inset.bottom;
    for (const [region, scroller] of [
      ["Deck", '.side-panel[data-panel="deck"]'],
      ["Sheets", ".sheet-scroller"],
      ["Print setup", '.side-panel[data-panel="print"]'],
    ] as const) {
      await showRegion(page, region);
      const boxes = await page.locator(scroller).evaluate(async (el) => {
        el.scrollTop = el.scrollHeight;
        await new Promise(requestAnimationFrame);
        const view = el.getBoundingClientRect();
        const focusable = (root: ParentNode) =>
          [
            ...root.querySelectorAll<HTMLElement>(
              "button, a[href], input, select, textarea, summary"
            ),
          ]
            .filter((e) => e.getClientRects().length > 0)
            .map((e) => e.getBoundingClientRect());
        const inside = focusable(el);
        return {
          last: inside.at(-1)!.bottom,
          shown: [
            // The scroller clips what overflows it, so measure the visible part.
            ...inside
              .filter(
                (r) =>
                  r.bottom > view.top &&
                  r.top < view.bottom &&
                  r.right > view.left &&
                  r.left < view.right
              )
              .map((r) => ({
                left: Math.max(r.left, view.left),
                right: Math.min(r.right, view.right),
              })),
            ...focusable(document.querySelector(".top-bar")!),
            ...focusable(document.querySelector(".preview-toolbar") ?? el),
          ].map((r) => ({ left: r.left, right: r.right })),
        };
      });
      const where = `${region} at ${width}×${height}`;
      expect(boxes.last, where).toBeLessThanOrEqual(floor);
      for (const r of boxes.shown) {
        expect(r.left, where).toBeGreaterThanOrEqual(inset.left);
        expect(r.right, where).toBeLessThanOrEqual(width - inset.right);
      }
    }
    await openExport(page);
    await exportDialog(page)
      .getByRole("button", { name: "Copy list", exact: true })
      .click();
    await page.keyboard.press("Escape");
    const notice = page
      .getByRole("region", { name: "Notifications" })
      .locator(".notice")
      .last();
    await expect(notice).toBeVisible();
    const box = (await notice.boundingBox())!;
    const where = `notification at ${width}×${height}`;
    expect(box.x, where).toBeGreaterThanOrEqual(inset.left);
    expect(box.x + box.width, where).toBeLessThanOrEqual(width - inset.right);
    expect(box.y + box.height, where).toBeLessThanOrEqual(floor);
  }
});

test("the sides choice is saved and decides what export produces", async ({
  page,
}) => {
  await addDeck(page, "10 Sol Ring");
  const saved = page.getByText("Saved in this browser", { exact: true });
  const slots = (pages: any[]) =>
    pages.map((p) =>
      p.positions.map((m: number[]) => [
        Math.round(m[4] * 10) / 10,
        Math.round(m[5] * 10) / 10,
      ])
    );
  await setTwoSided(page, true);
  await openExport(page);
  await page
    .getByLabel("One file, fronts and backs alternating", { exact: true })
    .check();
  await page.keyboard.press("Escape");
  await expect(saved).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Two-sided", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  const collated = await pdfInfo(
    await saveDownload(page, "Export collated PDF")
  );
  expect(collated.map((p: any) => p.images)).toEqual([9, 9, 1, 1]);

  await openExport(page);
  await page.getByLabel("Two files, fronts and backs", { exact: true }).check();
  const fronts = await pdfInfo(await saveDownload(page, "Export fronts PDF"));
  const backs = await pdfInfo(await saveDownload(page, "Export backs PDF"));
  expect(fronts.map((p: any) => p.images)).toEqual([9, 1]);
  expect(backs.map((p: any) => p.images)).toEqual([9, 1]);
  // The last card sits in the first column on its front and is mirrored to
  // the last column on its back.
  const pt = 72 / 25.4;
  expect(fronts[1].positions[0][4]).toBeCloseTo(7.45 * pt);
  expect(backs[1].positions[0][4]).toBeCloseTo((7.45 + 2 * 67) * pt);
  expect(slots(collated)).toEqual(
    slots([fronts[0], backs[0], fronts[1], backs[1]])
  );

  await openExport(page);
  await page
    .getByLabel("One file, fronts and backs alternating", { exact: true })
    .check();
  await page.keyboard.press("Escape");
  await setTwoSided(page, false);
  await expect(saved).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "One-sided", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await openExport(page);
  await expect(
    exportDialog(page).getByRole("button", {
      name: "Export fronts PDF",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    exportDialog(page).getByRole("button", {
      name: /^Export (backs|collated) PDF$/,
    })
  ).toHaveCount(0);
  const oneSided = await pdfInfo(await saveDownload(page, "Export fronts PDF"));
  expect(oneSided.map((p: any) => p.images)).toEqual([9, 1]);
  expect(slots(oneSided)).toEqual(slots(fronts));
});

test("dialogs return focus to their opener", async ({ page }) => {
  await addDeck(page, "1 Sol Ring");
  const opener = page.getByRole("button", { name: "Export", exact: true });
  await opener.click();
  await expect(exportDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(exportDialog(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await exportDialog(page)
    .getByRole("button", { name: "Close export", exact: true })
    .click();
  await expect(exportDialog(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
});

const deckPanel = (page: Page) => page.locator("#deck-panel");
const deckRow = (page: Page, name: string) =>
  deckPanel(page)
    .getByRole("listitem")
    .filter({
      has: page.getByRole("button", {
        name: `Show ${name} on the sheet`,
        exact: true,
      }),
    });
async function deckMenu(page: Page, name: string, item: string) {
  await deckPanel(page)
    .getByLabel(`More actions for ${name}`, { exact: true })
    .click();
  await deckPanel(page)
    .getByRole("button", { name: item, exact: true })
    .click();
}
const artButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `${name}, change artwork`, exact: true });
// The sheet's button for a card with no artwork.
const findButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `${name}, find artwork`, exact: true });

test("the deck list edits quantities, shows what needs artwork and undoes", async ({
  page,
}) => {
  await addDeck(page, `2 Sol Ring\n1 ${UNKNOWN_CARD}\n1 Fire // Ice`);
  await expect(
    page.getByText(
      `Added 4 cards. 1 card needs artwork: ${UNKNOWN_CARD}. Use Find artwork in the Deck panel.`,
      { exact: true }
    )
  ).toBeVisible();
  const deck = deckPanel(page);
  const summary = deck.getByRole("status");
  const rows = deck.getByRole("listitem");
  await expect(summary).toHaveText("3 ready, 1 card needs artwork");
  await expect(rows).toHaveCount(3);
  await expect(deckRow(page, "Sol Ring")).toContainText("C21 #123");
  await expect(deckRow(page, UNKNOWN_CARD)).toContainText("No artwork found");
  await expect(
    deck.getByText("4 of 1,000 cards", { exact: true })
  ).toBeVisible();

  const find = deck.getByRole("button", {
    name: `Find artwork for ${UNKNOWN_CARD}`,
  });
  await find.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(find).toBeFocused();

  await deck
    .getByRole("button", { name: "Show only cards that need artwork" })
    .click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(UNKNOWN_CARD);
  await deck.getByRole("button", { name: "Show all cards" }).click();
  await expect(rows).toHaveCount(3);
  await deck.getByLabel("Filter deck", { exact: true }).fill("ice");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Fire // Ice");
  await deck.getByLabel("Filter deck", { exact: true }).fill("");
  await expect(rows).toHaveCount(3);

  const show = deck.getByRole("button", {
    name: "Show Sol Ring on the sheet",
    exact: true,
  });
  await show.click();
  await expect(deckRow(page, "Sol Ring")).toContainText("copy 1 of 2");
  await show.click();
  await expect(deckRow(page, "Sol Ring")).toContainText("copy 2 of 2");

  await deck
    .getByRole("button", { name: "Add one Sol Ring", exact: true })
    .click();
  await expect(
    page.getByText("5 cards, 1 sheet", { exact: true })
  ).toBeVisible();
  await expect(artButton(page, "Sol Ring")).toHaveCount(3);
  await expect(deckRow(page, "Sol Ring").locator(".deck-qty")).toHaveText("3");
  const removeOne = deck.getByRole("button", {
    name: "Remove one Sol Ring",
    exact: true,
  });
  await removeOne.click();
  await removeOne.click();
  await expect(artButton(page, "Sol Ring")).toHaveCount(1);
  await expect(
    deck.getByRole("button", { name: "Undo: remove Sol Ring", exact: true })
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(artButton(page, "Sol Ring")).toHaveCount(2);
  await expect(deckRow(page, "Sol Ring").locator(".deck-qty")).toHaveText("2");

  // A copy added later sits apart from the others; minus removes that one.
  await addDeck(page, "1 Sol Ring");
  await expect(deckRow(page, "Sol Ring").locator(".deck-qty")).toHaveText("3");
  const sheetOrder = () =>
    page
      .getByRole("button", { name: /, (change|find) artwork$/ })
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect((await sheetOrder()).at(-1)).toBe("Sol Ring, change artwork");
  await removeOne.click();
  expect(await sheetOrder()).toEqual([
    "Sol Ring, change artwork",
    "Sol Ring, change artwork",
    `${UNKNOWN_CARD}, find artwork`,
    "Fire // Ice, change artwork",
  ]);

  await page.waitForTimeout(9000);
  await expect(summary).toHaveText("3 ready, 1 card needs artwork");

  // On a phone, choosing a row takes you to the sheet it is on.
  await page.setViewportSize({ width: 390, height: 844 });
  await showRegion(page, "Deck");
  await deck
    .getByRole("button", { name: "Show Fire // Ice on the sheet", exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Workspace regions" })
      .getByRole("button", { name: "Sheets", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
});

test("undo stays reachable after the deck is emptied", async ({ page }) => {
  const deck = deckPanel(page);
  await expect(deck.getByRole("button", { name: /^Undo/ })).toHaveCount(0);

  await addDeck(page, "2 Sol Ring\n1 Island");
  await expect(
    page.getByText("3 cards, 1 sheet", { exact: true })
  ).toBeVisible();
  await deck.getByLabel("Deck actions", { exact: true }).click();
  await page.getByRole("button", { name: "Clear deck", exact: true }).click();
  await confirmDialog(page, "Clear deck");
  await expect(page.getByLabel("Decklist", { exact: true })).toBeVisible();
  const undoClear = deck.getByRole("button", {
    name: "Undo: clear deck",
    exact: true,
  });
  await expect(undoClear).toBeFocused();
  const notice = page.getByText("Deck cleared.", { exact: false });
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCount(0, { timeout: 12_000 });
  await undoClear.click();
  await expect(artButton(page, "Sol Ring")).toHaveCount(2);
  await expect(artButton(page, "Island")).toHaveCount(1);
  await expect(
    page.getByText("3 cards, 1 sheet", { exact: true })
  ).toBeVisible();
  await expect(
    deck.getByRole("button", { name: "Undo: add 3 cards", exact: true })
  ).toBeFocused();

  await deckMenu(page, "Sol Ring", "Remove all 2 copies");
  await deck
    .getByRole("button", { name: "Remove one Island", exact: true })
    .click();
  await expect(page.getByLabel("Decklist", { exact: true })).toBeVisible();
  const undoRemove = deck.getByRole("button", {
    name: "Undo: remove Island",
    exact: true,
  });
  await expect(undoRemove).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(artButton(page, "Island")).toHaveCount(1);
  await expect(
    page.getByText("1 card, 1 sheet", { exact: true })
  ).toBeVisible();
  await expect(
    deck.getByRole("button", {
      name: "Undo: remove 2 copies of Sol Ring",
      exact: true,
    })
  ).toBeFocused();

  // History lasts for the session; with none left after an undo, focus goes
  // to Add cards.
  await expect(
    page.getByText("Saved in this browser", { exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(artButton(page, "Island")).toHaveCount(1);
  await deckMenu(page, "Island", "Remove card");
  await expect(
    deck.getByRole("button", { name: "Undo: remove Island", exact: true })
  ).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(artButton(page, "Island")).toHaveCount(1);
  await expect(
    deck.getByRole("button", { name: "Add cards", exact: true })
  ).toBeFocused();
  await expect(
    deck.getByRole("button", { name: "Undo", exact: true })
  ).toBeDisabled();
  await deckMenu(page, "Island", "Remove card");
  await expect(page.getByLabel("Decklist", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Saved in this browser", { exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Decklist", { exact: true })).toBeVisible();
  await expect(deck.getByRole("button", { name: /^Undo/ })).toHaveCount(0);
});

test("every card action is reachable from the deck on A1 at fit page", async ({
  page,
}) => {
  await addDeck(page, "1 Sol Ring\n1 Day // Night\n2 Island");
  await openAddCards(page);
  await page.getByLabel("Upload card images", { exact: true }).setInputFiles({
    name: "Own art.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  await expect(artButton(page, "Own art").getByRole("img")).toBeVisible();
  await showRegion(page, "Print setup");
  await page.getByLabel("Paper size", { exact: true }).selectOption("A1");
  await showRegion(page, "Deck");

  await deckMenu(page, "Sol Ring", "Change artwork");
  await page
    .getByRole("button", {
      name: "Choose Sol Ring, Commander Legends, CMR #123, 2020",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(deckRow(page, "Sol Ring")).toContainText("CMR #123");

  await deckMenu(page, "Day // Night", "Flip card");
  await expect(deckRow(page, "Day // Night")).toContainText("showing Night");

  const chooser = page.waitForEvent("filechooser");
  await deckMenu(page, "Own art", "Upload back image");
  await (
    await chooser
  ).setFiles({ name: "Own back.png", mimeType: "image/png", buffer: fixture });
  await expect(deckRow(page, "Own art")).toContainText("own back");

  const deck = deckPanel(page);
  await deck
    .getByRole("button", { name: "Add one Sol Ring", exact: true })
    .click();
  await expect(deckRow(page, "Sol Ring").locator(".deck-qty")).toHaveText("2");
  await deck
    .getByRole("button", { name: "Remove one Island", exact: true })
    .click();
  await expect(deckRow(page, "Island").locator(".deck-qty")).toHaveText("1");

  const sheetOrder = () =>
    page
      .getByRole("button", { name: /, change artwork$/ })
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute("aria-label")!.split(",")[0])
      );
  await deckMenu(page, "Sol Ring", "Move 2 copies to end");
  await expect(deck.getByRole("listitem").last()).toContainText("Sol Ring");
  await expect(
    deck.getByLabel("More actions for Sol Ring", { exact: true })
  ).toBeFocused();
  expect(await sheetOrder()).toEqual([
    "Day // Night",
    "Island",
    "Own art",
    "Sol Ring",
    "Sol Ring",
  ]);

  // One position at a time, with the copies a row holds moving together.
  await deckMenu(page, "Own art", "Move earlier");
  await expect(
    deck.getByLabel("More actions for Own art", { exact: true })
  ).toBeFocused();
  expect(await sheetOrder()).toEqual([
    "Day // Night",
    "Own art",
    "Island",
    "Sol Ring",
    "Sol Ring",
  ]);
  await deckMenu(page, "Sol Ring", "Move 2 copies earlier");
  expect(await sheetOrder()).toEqual([
    "Day // Night",
    "Own art",
    "Sol Ring",
    "Sol Ring",
    "Island",
  ]);
  await deck.getByLabel("More actions for Island", { exact: true }).click();
  await expect(
    deck.getByRole("button", { name: "Move later", exact: true })
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  // A one-card row passes one card, which leaves the Sol Ring copies apart.
  await deckMenu(page, "Island", "Move earlier");
  expect(await sheetOrder()).toEqual([
    "Day // Night",
    "Own art",
    "Sol Ring",
    "Island",
    "Sol Ring",
  ]);
  // Moving the row first gathers its copies at the first one.
  await deckMenu(page, "Sol Ring", "Move 2 copies later");
  expect(await sheetOrder()).toEqual([
    "Day // Night",
    "Own art",
    "Island",
    "Sol Ring",
    "Sol Ring",
  ]);
  await deck.getByLabel("More actions for Sol Ring", { exact: true }).click();
  for (const item of [
    "Change artwork",
    "Move 2 copies earlier",
    "Move 2 copies later",
    "Move 2 copies to start",
    "Move 2 copies to end",
    "Remove all 2 copies",
  ])
    await expect(
      deck.getByRole("button", { name: item, exact: true })
    ).toBeVisible();
  await page.keyboard.press("Escape");

  await expect.poll(() => savedUploads(page)).toEqual({ fronts: 1, backs: 1 });
  const requested: string[] = [];
  page.on("request", (request) => {
    if (isCardImage(request.url())) requested.push(request.url());
  });
  const pdf = await pdfInfo(await saveDownload(page, "Export fronts PDF"));
  expect(pdf).toHaveLength(1);
  expect(pdf[0].images).toBe(5);
  expect(pdf[0].width).toBeCloseTo((594 * 72) / 25.4, 0);
  expect(pdf[0].height).toBeCloseTo((841 * 72) / 25.4, 0);
  expect(requested).toContain("https://cards.scryfall.io/Sol%20Ring-cmr.png");
  expect(requested).not.toContain(
    "https://cards.scryfall.io/Sol%20Ring-c21.png"
  );
  expect(requested).toContain("https://cards.scryfall.io/night-c21.png");
});

test("a card's sheet menu knows when another card is added after it", async ({
  page,
}) => {
  await addDeck(page, "1 Sol Ring");
  const menu = page.getByLabel("Actions for Sol Ring", { exact: true });
  const later = page
    .locator(".card-menu")
    .getByRole("button", { name: "Move later", exact: true });
  await menu.click();
  await expect(later).toBeDisabled();
  await page.keyboard.press("Escape");
  await addDeck(page, "1 Island");
  await expect(artButton(page, "Island")).toHaveCount(1);
  await showRegion(page, "Sheets");
  await menu.click();
  await expect(later).toBeEnabled();
  await expect(
    page
      .locator(".card-menu")
      .getByRole("button", { name: "Move to end", exact: true })
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await showRegion(page, "Deck");
  await deckPanel(page)
    .getByLabel("More actions for Sol Ring", { exact: true })
    .click();
  await expect(
    deckPanel(page).getByRole("button", { name: "Move later", exact: true })
  ).toBeEnabled();
});

test("confirmed resets leave focus on the page", async ({ page }) => {
  await addDeck(page, "1 Sol Ring");
  const focused = () =>
    page.evaluate(() =>
      document.activeElement === document.body
        ? "body"
        : (document.activeElement?.getAttribute("aria-label") ??
          document.activeElement?.textContent ??
          "")
    );
  await showRegion(page, "Print setup");
  await page
    .getByRole("button", { name: "Reset settings", exact: true })
    .click();
  await confirmDialog(page, "Reset settings");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(focused).not.toBe("body");

  await page
    .getByRole("button", { name: "Reset app data", exact: true })
    .click();
  await confirmDialog(page, "Delete saved data");
  await expect(
    page.getByText("Saved workspace cleared.", { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(focused).not.toBe("body");
});

async function fileTransfer(
  page: Page,
  file: { name: string; type: string; bytes: Buffer }
) {
  return page.evaluateHandle(
    ({ name, type, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type }));
      return transfer;
    },
    { name: file.name, type: file.type, base64: file.bytes.toString("base64") }
  );
}

test("dropped files are ignored while a dialog is open and rejected when unsupported", async ({
  page,
}) => {
  await addDeck(page, "1 Sol Ring");
  const target = page.getByText("Card images, trimmed to the card edge", {
    exact: true,
  });
  const png = await fileTransfer(page, {
    name: "Dropped art.png",
    type: "image/png",
    bytes: fixture,
  });

  await openExport(page);
  await page.locator("body").dispatchEvent("dragenter", { dataTransfer: png });
  await expect(target).toBeHidden();
  await target.dispatchEvent("drop", { dataTransfer: png });
  await page.waitForTimeout(500);
  await expect(
    page.getByText("1 card, 1 sheet", { exact: true })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(exportDialog(page)).toHaveCount(0);

  const pdf = await fileTransfer(page, {
    name: "Deck.pdf",
    type: "application/pdf",
    bytes: Buffer.from("%PDF-1.4"),
  });
  await page.locator("body").dispatchEvent("dragenter", { dataTransfer: pdf });
  await expect(target).toBeVisible();
  await target.dispatchEvent("drop", { dataTransfer: pdf });
  await expect(target).toBeHidden();
  await expect(
    page.getByRole("alert").filter({
      hasText:
        "Drop PNG, JPEG, WebP, GIF or AVIF images, or an MPCFill XML file.",
    })
  ).toBeVisible();
  await expect(
    page.getByText("1 card, 1 sheet", { exact: true })
  ).toBeVisible();

  await page.locator("body").dispatchEvent("dragenter", { dataTransfer: png });
  await expect(target).toBeVisible();
  await target.dispatchEvent("drop", { dataTransfer: png });
  await expect(artButton(page, "Dropped art").getByRole("img")).toBeVisible();
  await expect(
    page.getByText("2 cards, 1 sheet", { exact: true })
  ).toBeVisible();
  await expect(deckRow(page, "Dropped art")).toContainText("Your image");
});

test("the Add cards dialog returns focus to its opener", async ({ page }) => {
  await addDeck(page, "1 Sol Ring");
  const opener = deckPanel(page).getByRole("button", {
    name: "Add cards",
    exact: true,
  });
  await opener.click();
  await expect(addCardsDialog(page)).toBeVisible();
  await expect(page.getByLabel("Decklist", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(addCardsDialog(page)).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  await page.getByLabel("Decklist", { exact: true }).fill("1 Island");
  await page.getByRole("button", { name: "Add to deck", exact: true }).click();
  await expect(addCardsDialog(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(
    page.getByText("2 cards, 1 sheet", { exact: true })
  ).toBeVisible();

  await deckPanel(page).getByLabel("Deck actions", { exact: true }).click();
  await page.getByRole("button", { name: "Clear deck", exact: true }).click();
  await confirmDialog(page, "Clear deck");
  await expect(
    deckPanel(page).getByRole("button", {
      name: "Undo: clear deck",
      exact: true,
    })
  ).toBeFocused();
  await page
    .getByRole("region", { name: "Notifications" })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(artButton(page, "Island")).toHaveCount(1);
  await expect(artButton(page, "Sol Ring")).toHaveCount(1);
});

test("the deck panel and Add cards dialog pass axe at every width", async ({
  page,
}) => {
  await addDeck(page, `2 Sol Ring\n1 ${UNKNOWN_CARD}\n1 Day // Night`);
  const scan = async (selector: string, where: string) => {
    const axe = await new AxeBuilder({ page })
      .include(selector)
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      axe.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
      where
    ).toEqual([]);
  };
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [1440, 1024, 390, 320]) {
      const where = `${scheme} at ${width}px`;
      await page.setViewportSize({ width, height: 900 });
      await showRegion(page, "Deck");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        where
      ).toBe(true);
      await scan("#deck-panel", where);
      await deckPanel(page)
        .getByLabel(`More actions for Day // Night`, { exact: true })
        .click();
      await scan("#deck-panel", `${where}, row menu open`);
      await page.keyboard.press("Escape");
      await openAddCards(page);
      await scan(".add-cards-dialog", `${where}, Add cards dialog`);
      await page.keyboard.press("Escape");
      await expect(addCardsDialog(page)).toHaveCount(0);
    }
  }
});

test("a populated deck and every dialog pass axe in both themes at every width", async ({
  page,
}) => {
  // The empty deck is scanned at the same widths by the responsive test.
  test.setTimeout(300_000);
  await addDeck(page, `2 Sol Ring\n1 ${UNKNOWN_CARD}\n1 Day // Night`);
  await expect(
    artButton(page, "Sol Ring").first().getByRole("img")
  ).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [width, height] of [
      [1440, 900],
      [768, 900],
      [390, 844],
      [320, 640],
    ]) {
      const at = `${scheme} at ${width}px`;
      await page.setViewportSize({ width, height });
      const regions =
        width < 760
          ? (["Deck", "Sheets", "Print setup"] as const)
          : width < 1180
            ? (["Deck", "Print setup"] as const)
            : [null];
      for (const region of regions) {
        if (region) await showRegion(page, region);
        await expectNoAxeViolations(page, `deck, ${at}, ${region ?? "all"}`);
      }

      await openExport(page);
      await expectNoAxeViolations(page, `export dialog, ${at}`);
      await page.keyboard.press("Escape");
      await expect(exportDialog(page)).toHaveCount(0);

      await showRegion(page, "Sheets");
      await artButton(page, "Sol Ring").first().click();
      await expect(choice(page, "Sol Ring", "cmr")).toBeVisible();
      for (const tab of ["Printings", "Bleed for this card"]) {
        const button = picker(page).getByRole("button", {
          name: tab,
          exact: true,
        });
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await expectNoAxeViolations(page, `picker, ${tab}, ${at}`);
      }
      await page.keyboard.press("Escape");
      await expect(picker(page)).toHaveCount(0);

      await showRegion(page, "Deck");
      await deckPanel(page).getByLabel("Deck actions", { exact: true }).click();
      await page
        .getByRole("button", { name: "Clear deck", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectNoAxeViolations(page, `confirm dialog, ${at}`);
      await confirmDialog(page, "Cancel");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  }
});

const TEST_DECK = "20 Sol Ring\n2 Counterspell\n1 Day // Night";

// --sheet-scale against the first sheet's rendered width over its width at 100%.
async function sheetMeasure(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(".sheet-scroller")!;
    const sheet = document.querySelector<HTMLElement>(".proxy-page")!;
    const box = sheet.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    return {
      scale: Number(
        getComputedStyle(scroller).getPropertyValue("--sheet-scale")
      ),
      rendered: box.width / ((parseFloat(sheet.style.width) * 96) / 25.4),
      width: box.width,
      inside:
        box.left >= view.left &&
        box.top >= view.top &&
        box.right <= view.right &&
        box.bottom <= view.bottom,
    };
  });
}
async function expectHonestScale(page: Page, where: string) {
  await expect
    .poll(async () => {
      const { scale, rendered } = await sheetMeasure(page);
      return Math.abs(scale - rendered);
    }, where)
    .toBeLessThanOrEqual(0.01);
}

test("the mat shows a whole sheet at document scale", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await addDeck(page, TEST_DECK);
  const zoom = page.getByLabel("Zoom", { exact: true });
  const shown = zoom.locator("option:checked");
  await expect(shown).toHaveText("Fit page");
  await expect.poll(async () => (await sheetMeasure(page)).inside).toBe(true);
  await expectHonestScale(page, "fit page");
  await expect(page.getByText("Sheet 1 of 3", { exact: true })).toBeVisible();

  await zoom.selectOption({ label: "Fit width" });
  await expectHonestScale(page, "fit width");
  await zoom.selectOption({ label: "100%" });
  await expect
    .poll(async () => (await sheetMeasure(page)).width)
    .toBeCloseTo(816, 0);
  await expectHonestScale(page, "100%");
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect(shown).toHaveText("75%");
  await expectHonestScale(page, "75%");

  await page.getByRole("button", { name: "Next sheet", exact: true }).click();
  await expect(page.getByText("Sheet 2 of 3", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Previous sheet", exact: true })
    .click();
  await expect(page.getByText("Sheet 1 of 3", { exact: true })).toBeVisible();

  // The last card is on sheet 3; showing it from the deck scrolls the mat.
  const last = page
    .locator(".sortable-card")
    .filter({ has: artButton(page, "Day // Night") });
  await expect(last).not.toBeInViewport();
  await deckPanel(page)
    .getByRole("button", {
      name: "Show Day // Night on the sheet",
      exact: true,
    })
    .click();
  await expect(last).toBeInViewport();
  await expect(last).toHaveAttribute("data-highlighted", "true");
  await expect(page.getByText("Sheet 3 of 3", { exact: true })).toBeVisible();
  await expect(last).not.toHaveAttribute("data-highlighted", { timeout: 4000 });

  await zoom.selectOption({ label: "Fit page" });
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
    [320, 640],
  ]) {
    await page.setViewportSize({ width, height });
    for (const [paper, orientation] of [
      ["Letter", "Portrait"],
      ["Letter", "Landscape"],
      ["A1", "Portrait"],
    ]) {
      await showRegion(page, "Print setup");
      await page.getByLabel("Paper size", { exact: true }).selectOption(paper);
      await page
        .getByRole("button", { name: orientation, exact: true })
        .click();
      await showRegion(page, "Sheets");
      await page.locator(".sheet-scroller").evaluate((el) => el.scrollTo(0, 0));
      const where = `${paper} ${orientation} at ${width}×${height}`;
      await expect
        .poll(async () => (await sheetMeasure(page)).inside, where)
        .toBe(true);
      await expectHonestScale(page, where);
    }
  }
});

test("an unknown card asks for artwork and never offers retry", async ({
  page,
}) => {
  const imageRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      request.resourceType() === "image" ||
      url.startsWith(CARD_CDN) ||
      url.includes("/api/cards/images/front")
    )
      imageRequests.push(decodeURIComponent(url));
  });
  await addDeck(page, `1 Sol Ring\n1 ${UNKNOWN_CARD}`);
  await expect(artButton(page, "Sol Ring").getByRole("img")).toBeVisible();
  const find = findButton(page, UNKNOWN_CARD);
  const card = page.locator(".sortable-card").filter({ has: find });
  await expect(card).toContainText("No artwork found");
  await expect(card.getByText("Find artwork", { exact: true })).toBeVisible();
  await expect(artButton(page, UNKNOWN_CARD)).toHaveCount(0);
  await expect(find).toHaveAccessibleDescription("No artwork found");
  await expect(page.getByRole("button", { name: /Retry/ })).toHaveCount(0);
  await card.getByText("Find artwork", { exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Retry/ })).toHaveCount(0);
  expect(imageRequests.length).toBeGreaterThan(0);
  expect(
    imageRequests.filter(
      (url) => url.includes(UNKNOWN_CARD) || /[?&]url=(&|$)/.test(url)
    )
  ).toEqual([]);
});

test("controls stay off the artwork until hover or focus", async ({ page }) => {
  // The night face stands out in both PDFs, so its place can be followed.
  const logo = await readFile(
    new URL("../client/public/logo.png", import.meta.url)
  );
  await page.route(`${CARD_CDN}**`, (route) =>
    /night/i.test(route.request().url())
      ? route.fulfill({ contentType: "image/png", body: logo, headers: CORS })
      : route.fallback()
  );
  await addDeck(page, "1 Sol Ring\n1 Counterspell\n1 Day // Night");
  const cards = page.locator(".sortable-card");
  const handle = (index: number) => cards.nth(index).locator(".drag-handle");
  const opacity = (index: number) =>
    handle(index).evaluate((el) => getComputedStyle(el).opacity);
  await page.mouse.move(1, 1);
  await expect.poll(() => opacity(0)).toBe("0");
  await cards.nth(0).hover();
  await expect.poll(() => opacity(0)).toBe("1");
  await page.mouse.move(1, 1);
  await expect.poll(() => opacity(0)).toBe("0");
  await artButton(page, "Counterspell").focus();
  await page.keyboard.press("Tab");
  await expect(handle(1)).toBeFocused();
  await expect.poll(() => opacity(1)).toBe("1");
  await expect.poll(() => opacity(0)).toBe("0");
  await artButton(page, "Counterspell").focus();

  await handle(2).hover();
  const from = (await handle(2).boundingBox())!;
  const to = (await cards.nth(0).boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y + 14, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect
    .poll(() =>
      page
        .getByRole("button", { name: /, change artwork$/ })
        .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))
    )
    .toEqual([
      "Day // Night, change artwork",
      "Sol Ring, change artwork",
      "Counterspell, change artwork",
    ]);

  // dnd-kit swallows clicks for 50 ms after a drop.
  await page.waitForTimeout(100);
  await setTwoSided(page, true);
  const [fronts] = await pdfInfo(await saveDownload(page, "Export fronts PDF"));
  const [backs] = await pdfInfo(await saveDownload(page, "Export backs PDF"));
  const odd = (sources: string[]) =>
    sources.findIndex((s) => sources.filter((t) => t === s).length === 1);
  expect(fronts.images).toBe(3);
  expect(backs.images).toBe(3);
  const front = fronts.positions[odd(fronts.sources)];
  const back = backs.positions[odd(backs.sources)];
  const pt = 72 / 25.4;
  // Day // Night is first on the sheet; its back sits mirrored behind it.
  expect(front[4]).toBeCloseTo(7.45 * pt);
  expect(back[4]).toBeCloseTo(fronts.width - front[4] - front[0]);
  expect(back[5]).toBeCloseTo(front[5]);
});

const showOnSheet = (page: Page, name: string) =>
  deckPanel(page).getByRole("button", {
    name: `Show ${name} on the sheet`,
    exact: true,
  });
const matCard = (page: Page, name: string) =>
  page.locator(".sortable-card").filter({ has: artButton(page, name) });

test("selecting a deck row again steps through its copies", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await addDeck(page, "4 Counterspell\n2 Sol Ring\n1 Day // Night");
  const counterspell = deckRow(page, "Counterspell");
  const solRing = deckRow(page, "Sol Ring");
  const copyText = /copy \d+ of \d+/;

  await showOnSheet(page, "Counterspell").click();
  await expect(counterspell).toContainText("copy 1 of 4");
  // Past the 1.6 s highlight.
  await page.waitForTimeout(2000);
  await showOnSheet(page, "Counterspell").click();
  await expect(counterspell).toContainText("copy 2 of 4");

  await matCard(page, "Day // Night").hover();
  await expect(deckRow(page, "Day // Night")).toHaveAttribute(
    "data-active",
    "true"
  );
  await page.mouse.move(1, 1);
  await showOnSheet(page, "Counterspell").click();
  await expect(counterspell).toContainText("copy 3 of 4");

  await matCard(page, "Sol Ring").first().hover();
  await expect(solRing).toHaveAttribute("data-active", "true");
  await expect(solRing).not.toContainText(copyText);
  await expect(counterspell).toContainText("copy 3 of 4");

  await showOnSheet(page, "Sol Ring").click();
  await expect(solRing).toContainText("copy 1 of 2");
  await expect(counterspell).not.toContainText(copyText);
  await showOnSheet(page, "Sol Ring").click();
  await expect(solRing).toContainText("copy 2 of 2");

  // Removes the copy last shown; no row is left pointing at it.
  await deckPanel(page)
    .getByRole("button", { name: "Remove one Sol Ring", exact: true })
    .click();
  await expect(deckPanel(page)).not.toContainText(copyText);
});

test("showing a card from the deck on a phone brings it into view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await addDeck(page, TEST_DECK);
  await showRegion(page, "Deck");
  await showOnSheet(page, "Day // Night").click();
  const scroller = page.locator(".sheet-scroller");
  await expect(scroller).toBeVisible();
  const card = matCard(page, "Day // Night");
  const inside = async () => {
    const box = await card.boundingBox();
    const view = await scroller.boundingBox();
    return (
      !!box &&
      !!view &&
      box.y >= view.y &&
      box.y + box.height <= view.y + view.height &&
      box.x >= view.x &&
      box.x + box.width <= view.x + view.width
    );
  };
  await expect.poll(inside, { timeout: 3000 }).toBe(true);
  // Still there once any smooth scroll and late layout have settled.
  await page.waitForTimeout(1000);
  expect(await inside()).toBe(true);
});

test("a one-sheet deck at fit page does not scroll", async ({ page }) => {
  await addDeck(page, "1 Sol Ring");
  const scroller = page.locator(".sheet-scroller");
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
    [320, 640],
  ]) {
    await page.setViewportSize({ width, height });
    for (const orientation of ["Portrait", "Landscape"]) {
      await showRegion(page, "Print setup");
      await page
        .getByLabel("Paper size", { exact: true })
        .selectOption("Letter");
      await page
        .getByRole("button", { name: orientation, exact: true })
        .click();
      await showRegion(page, "Sheets");
      const where = `Letter ${orientation} at ${width}×${height}`;
      await expectHonestScale(page, where);
      await expect
        .poll(
          () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight),
          where
        )
        .toBeLessThanOrEqual(0);
    }
  }
  // A larger browser font makes the sheet label taller.
  await page.setViewportSize({ width: 1440, height: 900 });
  await showRegion(page, "Print setup");
  await page.getByRole("button", { name: "Portrait", exact: true }).click();
  await page.evaluate(() => (document.documentElement.style.fontSize = "24px"));
  // Let the resize observers and re-render settle; a mid-way frame can fit.
  await page.waitForTimeout(500);
  expect(
    await scroller.evaluate((el) => el.scrollHeight - el.clientHeight),
    "Letter Portrait with a 24 px root font"
  ).toBeLessThanOrEqual(0);
});

const picker = (page: Page) => page.getByRole("dialog", { name: /.+/ });
const choice = (page: Page, name: string, set: "c21" | "cmr") =>
  page.getByRole("button", {
    name:
      set === "c21"
        ? `Choose ${name}, Commander 2021, C21 #123, 2021`
        : `Choose ${name}, Commander Legends, CMR #123, 2020`,
    exact: true,
  });
async function zipRequests(page: Page) {
  for (const art of await page
    .getByRole("button", { name: /, change artwork$/ })
    .all())
    await expect(art.getByRole("img")).toBeVisible();
  const sources = new Map<string, Buffer>();
  const routePattern = `${CARD_CDN}**`;
  const handler = async (route: import("@playwright/test").Route) => {
    const url = route.request().url();
    const bytes = Buffer.concat([fixture, Buffer.from(url)]);
    sources.set(url, bytes);
    await route.fulfill({
      contentType: "image/png",
      body: bytes,
      headers: CORS,
    });
  };
  await page.route(routePattern, handler);
  const zip = await JSZip.loadAsync(
    await saveDownload(page, "Download original images · ZIP")
  );
  await page.unroute(routePattern, handler);
  const requested: string[] = [];
  for (const entry of Object.values(zip.files)) {
    const bytes = await entry.async("nodebuffer");
    const source = [...sources].find(([, expected]) => bytes.equals(expected));
    if (source) requested.push(source[0]);
    else expect(bytes).toEqual(fixture);
  }
  return { files: Object.keys(zip.files).length, requested: requested.sort() };
}

test("the picker labels printings by set and shows many at once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Several copies, so the scope options take their room too.
  await addDeck(page, `4 ${MANY_PRINTS}`);
  await artButton(page, MANY_PRINTS).first().click();
  await expect(
    page
      .getByRole("group", { name: "Change" })
      .getByRole("radio", { name: "The 4 copies in this row", exact: true })
  ).toBeVisible();
  const choices = picker(page).getByRole("button", { name: /^Choose / });
  await expect(choices).toHaveCount(24);
  const visible = await page.locator(".artwork-body").evaluate((body) => {
    const box = body.getBoundingClientRect();
    return [...body.querySelectorAll(".artwork-choice")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.top >= box.top &&
          r.bottom <= box.bottom &&
          r.left >= box.left &&
          r.right <= box.right
        );
      })
      .map((el) => ({
        name: el.getAttribute("aria-label"),
        text: (el as HTMLElement).innerText,
      }));
  });
  expect(visible.length).toBeGreaterThanOrEqual(18);
  for (const { name, text } of visible) {
    const [, set, code, year] = name!.match(
      /^Choose Many Prints, (Many Prints Set \d+), (M\d\d) #123, (\d{4})$/
    )!;
    expect(text).toContain(set);
    expect(text).toContain(`${code} #123, ${year}`);
  }
  await expect(
    picker(page).getByRole("heading", {
      name: `Printings of ${MANY_PRINTS}`,
      exact: true,
    })
  ).toBeVisible();
  await page.getByLabel("Filter by set name or code").fill("Set 12");
  await expect(choices).toHaveCount(1);
  await expect(picker(page).getByRole("status").first()).toHaveText(
    "1 of 24 printings"
  );
});

test("a printing that is a different card says so", async ({ page }) => {
  await addDeck(page, "1 Lightning Bolt\n1 Day // Night");
  await artButton(page, "Lightning Bolt").click();
  const other = picker(page).getByRole("button", {
    name: `Choose ${OTHER_CARD}, Commander Legends, CMR #7, 2020`,
    exact: true,
  });
  await expect(other).toBeVisible();
  await expect(other).toContainText(OTHER_CARD);
  await expect(choice(page, "Lightning Bolt", "c21")).not.toContainText(
    OTHER_CARD
  );
  await expect(
    picker(page).getByText(
      "Some printings are a different card and will rename this one.",
      { exact: true }
    )
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);

  // The two faces of a double-faced printing name their face.
  await artButton(page, "Day // Night").click();
  for (const face of ["Day", "Night"]) {
    const button = picker(page).getByRole("button", {
      name: `Choose Day // Night, ${face}, Commander Legends, CMR #123, 2020`,
      exact: true,
    });
    await expect(button.getByText(face, { exact: true })).toBeVisible();
  }
  await expect(
    picker(page).getByText(/Some printings are a different card/)
  ).toHaveCount(0);
});

test("replacing a card is separate from choosing a printing", async ({
  page,
}) => {
  await addDeck(page, "1 Sol Ring");
  await artButton(page, "Sol Ring").click();
  await expect(
    picker(page).getByRole("heading", {
      name: "Printings of Sol Ring",
      exact: true,
    })
  ).toBeVisible();
  await expect(choice(page, "Sol Ring", "cmr")).toBeVisible();
  await expect(page.getByLabel("Find a card", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Choosing one replaces/)).toHaveCount(0);
  const replace = page.getByRole("button", {
    name: "Replace with a different card",
    exact: true,
  });
  await expect(replace).toHaveAttribute("aria-expanded", "false");
  await replace.click();
  await expect(replace).toHaveAttribute("aria-expanded", "true");
  await page.getByLabel("Find a card", { exact: true }).fill("Fire // Ice");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    picker(page).getByRole("heading", {
      name: "Printings of Fire // Ice",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByText("Choosing one replaces Sol Ring.", { exact: true })
  ).toBeVisible();
  await choice(page, "Fire // Ice", "cmr").click();
  await expect(picker(page)).toHaveCount(0);
  await expect(artButton(page, "Fire // Ice").getByRole("img")).toBeVisible();
  await expect(artButton(page, "Sol Ring")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    page.getByText("Undid: replace Sol Ring with Fire // Ice.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(artButton(page, "Sol Ring")).toHaveCount(1);
});

test("a card with no artwork opens the picker with the search showing", async ({
  page,
}) => {
  await addDeck(page, `1 ${UNKNOWN_CARD}`);
  await findButton(page, UNKNOWN_CARD).click();
  const search = page.getByLabel("Find a card", { exact: true });
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await expect(
    page.getByText(`No printings found for “${UNKNOWN_CARD}”.`, {
      exact: false,
    })
  ).toBeVisible();
  await search.fill("Sol Ring");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByText(`Choosing one replaces ${UNKNOWN_CARD}.`, { exact: true })
  ).toBeVisible();
  await choice(page, "Sol Ring", "c21").click();
  await expect(artButton(page, "Sol Ring").getByRole("img")).toBeVisible();
});

test("each scope changes exactly the cards it names", async ({ page }) => {
  await addDeck(page, "3 Sol Ring");
  await openAddCards(page);
  await page.getByLabel("Upload card images", { exact: true }).setInputFiles({
    name: "Sol Ring.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  const cards = artButton(page, "Sol Ring");
  await expect(cards).toHaveCount(4);
  for (const card of await cards.all())
    await expect(card.getByRole("img")).toBeVisible();
  await showRegion(page, "Deck");
  const rows = deckPanel(page).getByRole("listitem");
  const rowTexts = () =>
    rows.evaluateAll((items) =>
      items.map((item) =>
        [
          item.querySelector(".deck-qty")?.textContent,
          item.querySelector(".deck-row-meta")?.textContent,
        ].join(" ")
      )
    );
  const C21 = "https://cards.scryfall.io/Sol%20Ring-c21.png";
  const CMR = "https://cards.scryfall.io/Sol%20Ring-cmr.png";
  expect(await rowTexts()).toEqual(["3 C21 #123", "1 Your image"]);

  // From the sheet: this copy only.
  await showRegion(page, "Sheets");
  await cards.first().click();
  const scope = page.getByRole("group", { name: "Change" });
  await expect(scope.getByRole("radio")).toHaveCount(3);
  await expect(
    scope.getByRole("radio", { name: "This copy", exact: true })
  ).toBeChecked();
  await expect(
    scope.getByRole("radio", { name: "The 3 copies in this row", exact: true })
  ).not.toBeChecked();
  await expect(page.getByText(/^This replaces/)).toHaveCount(0);
  await choice(page, "Sol Ring", "cmr").click();
  await expect(picker(page)).toHaveCount(0);
  await showRegion(page, "Deck");
  await expect
    .poll(rowTexts)
    .toEqual(["1 CMR #123", "2 C21 #123", "1 Your image"]);
  expect(await zipRequests(page)).toEqual({
    files: 4,
    requested: [C21, C21, CMR],
  });

  // From the two-copy row: the row is preselected.
  await rows.nth(1).getByLabel("More actions for Sol Ring").click();
  await deckPanel(page)
    .getByRole("button", { name: "Change artwork", exact: true })
    .click();
  await expect(
    scope.getByRole("radio", { name: "The 2 copies in this row", exact: true })
  ).toBeChecked();
  await expect(
    scope.getByRole("radio", {
      name: "All 4 cards named Sol Ring, across printings",
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByText(/^This replaces/)).toHaveCount(0);
  await choice(page, "Sol Ring", "cmr").click();
  await expect(picker(page)).toHaveCount(0);
  await expect.poll(rowTexts).toEqual(["3 CMR #123", "1 Your image"]);
  expect(await zipRequests(page)).toEqual({
    files: 4,
    requested: [CMR, CMR, CMR],
  });

  // Every card with the name, including the upload.
  await rows.nth(0).getByLabel("More actions for Sol Ring").click();
  await deckPanel(page)
    .getByRole("button", { name: "Change artwork", exact: true })
    .click();
  await expect(
    scope.getByRole("radio", { name: "The 3 copies in this row", exact: true })
  ).toBeChecked();
  await scope
    .getByRole("radio", {
      name: "All 4 cards named Sol Ring, across printings",
      exact: true,
    })
    .check();
  await expect(
    page.getByText("This replaces 1 uploaded image.", { exact: true })
  ).toBeVisible();
  await choice(page, "Sol Ring", "c21").click();
  await expect(picker(page)).toHaveCount(0);
  await expect.poll(rowTexts).toEqual(["4 C21 #123"]);
  expect(await zipRequests(page)).toEqual({
    files: 4,
    requested: [C21, C21, C21, C21],
  });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    page.getByText("Undid: change artwork for 4 cards named Sol Ring.", {
      exact: true,
    })
  ).toBeVisible();
  await expect.poll(rowTexts).toEqual(["3 CMR #123", "1 Your image"]);
});

test("choosing the printing a card already has records nothing", async ({
  page,
}) => {
  await addDeck(page, "1 Sol Ring");
  await artButton(page, "Sol Ring").click();
  await expect(choice(page, "Sol Ring", "c21")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(
    choice(page, "Sol Ring", "c21").getByText("Selected", { exact: true })
  ).toBeVisible();
  await showRegion(page, "Deck");
  const undo = deckPanel(page).getByRole("button", { name: /^Undo/ });
  const before = await undo.getAttribute("aria-label");
  await choice(page, "Sol Ring", "c21").click();
  await expect(picker(page)).toHaveCount(0);
  await expect(undo).toHaveAttribute("aria-label", before!);
});

test("an uploaded image can be switched to MPC bleed after upload", async ({
  page,
}) => {
  const art = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 816;
    canvas.height = 1110;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 816, 1110);
    ctx.fillStyle = "blue";
    ctx.fillRect(36, 36, 744, 1038);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const buffer = Buffer.from(art, "base64");
  await page.getByLabel("Upload MPC images", { exact: true }).setInputFiles({
    name: "Mpc.png",
    mimeType: "image/png",
    buffer,
  });
  await expect(artButton(page, "Mpc").getByRole("img")).toBeVisible();
  await openAddCards(page);
  await page.getByLabel("Upload card images", { exact: true }).setInputFiles({
    name: "Plain.png",
    mimeType: "image/png",
    buffer,
  });
  await expect(artButton(page, "Plain").getByRole("img")).toBeVisible();
  // Each placement is its size on the page and a hash of the image drawn.
  const placed = async () => {
    const [sheet] = await pdfInfo(
      await saveDownload(page, "Export fronts PDF")
    );
    expect(sheet.images).toBe(2);
    return sheet.positions.map(([a, , , d]: number[], i: number) => [
      a.toFixed(3),
      d.toFixed(3),
      sheet.sources[i],
    ]);
  };
  const before = await placed();
  expect(before[1]).not.toEqual(before[0]);
  await artButton(page, "Plain").click();
  await picker(page)
    .getByRole("button", { name: "Bleed for this card", exact: true })
    .click();
  const baked = page.getByLabel("Image includes 3 mm MPC bleed", {
    exact: true,
  });
  await expect(baked).not.toBeChecked();
  await baked.check();
  await expect(
    page.getByRole("img", { name: "Card bleed preview", exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close artwork picker", exact: true })
    .click();
  await expect(artButton(page, "Plain").getByRole("img")).toBeVisible();
  const after = await placed();
  expect(after[1]).toEqual(after[0]);
});

test("the picker returns focus to the card that opened it", async ({
  page,
}) => {
  await addDeck(page, "2 Sol Ring");
  const card = artButton(page, "Sol Ring").first();
  await expect(card.getByRole("img")).toBeVisible();
  await card.click();
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toBeFocused();
  await card.click();
  await choice(page, "Sol Ring", "cmr").click();
  await expect(picker(page)).toHaveCount(0);
  await expect(card).toBeFocused();

  await showRegion(page, "Deck");
  const menu = deckRow(page, "Sol Ring")
    .filter({ hasText: "C21 #123" })
    .getByLabel("More actions for Sol Ring", { exact: true });
  await menu.click();
  await deckPanel(page)
    .getByRole("button", { name: "Change artwork", exact: true })
    .click();
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await menu.click();
  await deckPanel(page)
    .getByRole("button", { name: "Change artwork", exact: true })
    .click();
  await choice(page, "Sol Ring", "cmr").click();
  await expect(picker(page)).toHaveCount(0);
  await expect(
    deckPanel(page).getByLabel("More actions for Sol Ring", { exact: true })
  ).toBeFocused();
});

test("both picker tabs pass axe", async ({ page }) => {
  await addDeck(page, "2 Sol Ring");
  await openAddCards(page);
  await page.getByLabel("Upload card images", { exact: true }).setInputFiles({
    name: "Sol Ring.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  await expect(artButton(page, "Sol Ring")).toHaveCount(3);
  for (const scheme of ["light", "dark"] as const)
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height });
      await showRegion(page, "Sheets");
      await artButton(page, "Sol Ring").first().click();
      await expect(choice(page, "Sol Ring", "cmr")).toBeVisible();
      await page
        .getByRole("radio", {
          name: "All 3 cards named Sol Ring, across printings",
        })
        .check();
      for (const tab of ["Printings", "Bleed for this card"]) {
        const button = picker(page).getByRole("button", {
          name: tab,
          exact: true,
        });
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        const axe = await new AxeBuilder({ page })
          .include("dialog")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(
          axe.violations.map((v) => ({
            id: v.id,
            where: `${tab} at ${width} px, ${scheme}`,
            nodes: v.nodes.map((n) => n.target),
          }))
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(picker(page)).toHaveCount(0);
    }
});
