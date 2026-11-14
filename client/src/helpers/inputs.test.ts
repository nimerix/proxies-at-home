import { expect, it } from "vitest";
import { parseDeckToInfos } from "./CardInfoHelper";
import { toProxied } from "./imageUtils";
import { bakedBleedCrop } from "./canvasProcessing";
import { guessBucketDpiFromHeight } from "./dpiHelpers";
import { cardSource } from "./cardSources";
import { pixelDPIMap } from "../constants";
import { getMpcImageUrl } from "./Mpc";

it("parses quantities, printings and split cards while skipping section headings", () => {
  expect(
    parseDeckToInfos(
      "Deck\n2x Fire // Ice (mh2) 290\n// note\nSideboard\n1 Sol Ring (c21) 123★ *F*"
    )
  ).toEqual([
    { name: "Fire // Ice", set: "mh2", number: "290" },
    { name: "Fire // Ice", set: "mh2", number: "290" },
    { name: "Sol Ring", set: "c21", number: "123★" },
  ]);
  expect(() => parseDeckToInfos("99999999999 Sol Ring")).toThrow(/1,000/);
});
it("does not proxy local, uploaded or already proxied images twice", () => {
  for (const src of [
    "/cardback.png",
    "/api/cards/images/front?id=abc",
    "blob:abc",
    "data:image/png;base64,abc",
    "/api/cards/images/proxy?url=abc",
  ])
    expect(toProxied(src)).toBe(src);
  const proxied = toProxied("https://cards.scryfall.io/test.png");
  expect(toProxied(proxied)).toBe(proxied);
  expect(getMpcImageUrl("public-drive-id")).toBe(
    "/api/cards/images/front?id=public-drive-id"
  );
  expect(
    toProxied("https://old-api.example/api/cards/images/front?id=abc")
  ).toBe("/api/cards/images/front?id=abc");
});
it("preserves the physical trim box for MPC images at zero and smaller bleed", () => {
  for (const desired of [0, 1, 2, 3]) {
    const crop = bakedBleedCrop(690, 940, desired);
    expect(crop.width).toBe((63 + 2 * desired) * 10);
    expect(crop.height).toBe((88 + 2 * desired) * 10);
  }
  for (const [dpi, size] of pixelDPIMap)
    expect(guessBucketDpiFromHeight(size.heightWithBakedBleed)).toEqual({
      dpi,
      hasBleed: true,
    });
});
it("uses the currently selected face and the opposite back", () => {
  const card = {
    uuid: "1",
    name: "Front",
    imageUrls: ["front", "back"],
    isUserUpload: false,
    currentFaceIndex: 1,
    faces: [
      { name: "Front", imageUrl: "front", faceIndex: 0 },
      { name: "Back", imageUrl: "back", faceIndex: 1 },
    ],
  };
  expect(
    cardSource(card, { originalSelectedImages: { "1": "back" } }).source
  ).toBe("back");
  expect(cardSource(card, { originalSelectedImages: {} }, true).source).toBe(
    "front"
  );
  expect(
    cardSource(
      card,
      {
        originalSelectedImages: {},
        originalSelectedBackImages: { "1": "/api/cards/images/front?id=123" },
      },
      true
    ).source
  ).toContain("id=123");
});
