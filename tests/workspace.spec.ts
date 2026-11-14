import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const requireClient = createRequire(
  new URL("../client/package.json", import.meta.url)
);
const { PDFDocument, PDFArray, PDFName, decodePDFRawStream } =
  requireClient("pdf-lib");
const JSZip = requireClient("jszip");
const fixture = await readFile(
  new URL("../client/public/cardback.png", import.meta.url)
);

async function mockCards(page: Page) {
  await page.route("https://cards.scryfall.io/**", (route) =>
    route.fulfill({ contentType: "image/png", body: fixture })
  );
  await page.route("**/api/cards/images**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith("/proxy") || url.pathname.endsWith("/front"))
      return route.fulfill({ contentType: "image/png", body: fixture });
    if (url.pathname.endsWith("/sets"))
      return route.fulfill({
        json: {
          data: [
            { code: "c21", name: "Commander 2021" },
            { code: "cmr", name: "Commander Legends" },
          ],
        },
      });
    if (url.pathname.endsWith("/autocomplete"))
      return route.fulfill({
        json: { data: ["Sol Ring", "Fire // Ice", "Day // Night"] },
      });
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      const infos =
        body.cardQueries || body.cardNames.map((name: string) => ({ name }));
      const cards = infos.flatMap(
        (q: { name: string; set?: string; number?: string }) => {
          return (
            body.cardArt === "prints" ? ["c21", "cmr"] : [q.set || "c21"]
          ).map((set) => {
            const front = `https://cards.scryfall.io/${encodeURIComponent(q.name)}-${set}.png`;
            const faces = [
              {
                name: q.name,
                imageUrl: front,
                thumbUrl: front.replace(".png", "-normal.jpg"),
                faceIndex: 0,
              },
            ];
            if (q.name === "Day // Night")
              faces.push({
                name: "Night",
                imageUrl: `https://cards.scryfall.io/night-${set}.png`,
                thumbUrl: `https://cards.scryfall.io/night-${set}-normal.jpg`,
                faceIndex: 1,
              });
            return {
              name: q.name,
              set,
              number: q.number || "123",
              query: q,
              imageUrls: faces.map((f) => f.imageUrl),
              faces,
            };
          });
        }
      );
      return route.fulfill({ json: cards });
    }
    return route.fulfill({ status: 404 });
  });
}
async function addDeck(page: Page, deck: string) {
  await page.getByLabel("Decklist", { exact: true }).fill(deck);
  await page.getByRole("button", { name: "Add to deck", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function saveDownload(page: Page, button: string) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
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
      positions: number[][] = [];
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
      } else if (/^\/Image[^\s]* Do$/.test(command))
        positions.push([...matrix]);
    }
    return {
      width: page.getWidth(),
      height: page.getHeight(),
      images: positions.length,
      positions,
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

test("responsive workspace and accessible empty states", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      const panels =
        width < 1100 ? ["Add cards", "Preview", "Print settings"] : [null];
      for (const panel of panels) {
        if (panel)
          await page
            .getByRole("navigation")
            .getByRole("button", { name: panel, exact: true })
            .click();
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
  await page.getByRole("button", { name: "Switch to landscape" }).click();
  await page.getByText("Card backs & duplex", { exact: true }).click();
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
    page.getByRole("button", { name: "Switch to portrait" })
  ).toBeVisible();
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
  await page.getByText("Card backs & duplex", { exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Your custom cardback" })
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Reset app data", exact: true })
    .click();
  await expect(
    page.getByText("Saved workspace cleared.", { exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Your next deck starts here.",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Switch to landscape" })
  ).toBeVisible();
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
      name: "Choose Day // Night, cmr 123, face 2",
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
    if (request.url().includes("/proxy?"))
      zipSources.push(new URL(request.url()).searchParams.get("url") || "");
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
  await page.getByLabel("Find a card", { exact: true }).fill("Fire // Ice");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Choose Fire // Ice, cmr 123, face 1",
      exact: true,
    })
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Choose Fire // Ice, cmr 123, face 1",
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
    await page.getByText("Card backs & duplex", { exact: true }).click();
    await page.getByLabel("Collate fronts and backs in one PDF").check();
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
  await page.getByText("Card backs & duplex", { exact: true }).click();
  await page.getByLabel("Collate fronts and backs in one PDF").check();
  expect(
    await pdfInfo(await saveDownload(page, "Export collated PDF"))
  ).toHaveLength(2);
});

test("mixed duplex export, keyboard actions, mobile preview and artwork dialog", async ({
  page,
}) => {
  await addDeck(page, "1 Sol Ring\n1 Day // Night");
  await page
    .getByRole("button", { name: "Switch to landscape", exact: true })
    .click();
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
  await page.getByText("Card backs & duplex", { exact: true }).click();
  await page.getByLabel("Custom cardback", { exact: true }).setInputFiles({
    name: "Global.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  await page.getByLabel("Collate fronts and backs in one PDF").check();
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
      name: "Choose Sol Ring, cmr 123, face 1",
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
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Preview", exact: true })
    .click();
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
  await page.route("**/api/cards/images/proxy?**", (route) =>
    route.fulfill({ status: 502, json: { error: "Image unavailable" } })
  );
  await page
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
  await page.route("**/api/cards/images", async (route) => {
    started();
    await requestRelease;
    await route.abort();
  });
  await page.getByLabel("Decklist", { exact: true }).fill("1 Counterspell");
  await page.getByRole("button", { name: "Add to deck", exact: true }).click();
  await requestStarted;
  await page
    .getByRole("button", { name: "Cancel import", exact: true })
    .click();
  release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
    page.getByRole("button", { name: "Switch to portrait", exact: true })
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Switch to landscape" }).click();
  await expect(
    page.getByRole("button", { name: "Switch to portrait" })
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Changes could not be saved" })
  ).toBeVisible();
});

test("collated batching keeps front and back pairs together", async ({
  page,
}) => {
  await addDeck(page, "10 Sol Ring");
  await page.getByText("Card backs & duplex", { exact: true }).click();
  await page.getByLabel("Collate fronts and backs in one PDF").check();
  await page.getByText("Export quality & files", { exact: true }).click();
  await page.getByLabel("Split PDF into smaller files").check();
  await page.getByLabel("Pages per file", { exact: true }).fill("3");
  const downloads: import("@playwright/test").Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await page
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
  await page.getByText("Bleed artwork", { exact: true }).click();
  const setInset = async (value: string) => {
    const old = await preview.getAttribute("src");
    await page.getByLabel("Shadow removal (mm)", { exact: true }).fill(value);
    await page
      .getByLabel("Shadow removal (mm)", { exact: true })
      .press("Enter");
    await expect(preview).not.toHaveAttribute("src", old!);
  };
  await setInset("0");
  await page.getByText("Card backs & duplex", { exact: true }).click();
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
  await page.getByText("Export quality & files", { exact: true }).click();
  for (const dpi of [600, 900, 1200]) {
    await page
      .getByLabel("Resolution", { exact: true })
      .selectOption(String(dpi));
    await checkCorners(
      await embeddedJpeg(await saveDownload(page, "Export fronts PDF")),
      dpi
    );
  }
  await page.getByText("Bleed artwork", { exact: true }).click();
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
  await page.getByText("Bleed artwork", { exact: true }).click();
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
      await page.getByText("Bleed artwork", { exact: true }).click();
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
      await page.getByText("Bleed artwork", { exact: true }).click();
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
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", {
      name: "Delete saved data and start fresh",
      exact: true,
    })
    .click();
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
  await page
    .getByRole("button", { name: "Switch to landscape", exact: true })
    .click();
  await expect(page.getByLabel("Columns", { exact: true })).toHaveValue("4");
  await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("2");
  await page
    .getByRole("button", { name: "Switch to portrait", exact: true })
    .click();
  await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("3");
  const columns = page.getByLabel("Columns", { exact: true });
  await columns.fill("");
  await expect(columns).toHaveValue("");
  await columns.pressSequentially("2");
  await columns.press("Enter");
  await expect(columns).toHaveValue("2");
  await page
    .getByRole("button", { name: "Switch to landscape", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Switch to portrait", exact: true })
    .click();
  await expect(columns).toHaveValue("2");
  await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("3");
  await page.getByText("Cutting guides", { exact: true }).click();
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
    name: "Choose Sol Ring, cmr 123, face 1",
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
  expect(requests.some((url) => url.includes("/proxy?"))).toBe(false);
  await choice.click();
  await expect(art.getByRole("img")).toBeVisible();
  await saveDownload(page, "Download original images · ZIP");
  expect(
    requests.some(
      (url) =>
        url.includes("/proxy?") &&
        decodeURIComponent(url).includes("Sol%20Ring-cmr.png")
    )
  ).toBe(true);
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
  await page.route("**/api/cards/images/proxy?**", (route) =>
    fail
      ? route.fulfill({ status: 503, body: "Unavailable" })
      : route.fulfill({ contentType: "image/png", body: fixture })
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
    await page
      .getByLabel("Upload card images", { exact: true })
      .setInputFiles({
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
