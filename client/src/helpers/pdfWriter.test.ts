import { expect, test } from "vitest";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  rgb,
} from "pdf-lib";
import { numberToString } from "pdf-lib/cjs/utils/numbers";
import {
  PdfWriter,
  drawImageOps,
  drawLineOps,
  drawRectangleOps,
  pdfNumber,
} from "./pdfWriter";

// A 2 × 1 baseline JPEG with three channels.
const JPEG = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAA" +
      "A6ABAAMAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMu" +
      "MAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQACAwEiAAIR" +
      "AQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAAB" +
      "fQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5" +
      "OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeo" +
      "qaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMB" +
      "AQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYS" +
      "QVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNU" +
      "VVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5" +
      "usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMABgYGBgYGCgYGCg4KCgoO" +
      "Eg4ODg4SFxISEhISFxwXFxcXFxccHBwcHBwcHCIiIiIiIicnJycnLCwsLCwsLCwsLP/bAEMBBwcH" +
      "CwoLEwoKEy4fGh8uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4u" +
      "Li4uLv/dAAQAAf/aAAwDAQACEQMRAD8A5OiiikYn/9k="
  ),
  (c) => c.charCodeAt(0)
);

async function pageText(doc: PDFDocument) {
  const contents = doc.getPages()[0].node.Contents()!;
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  return streams
    .map((stream) =>
      new TextDecoder().decode(
        decodePDFRawStream(stream as PDFRawStream).decode()
      )
    )
    .join("\n");
}

test("formats numbers like pdf-lib", () => {
  for (const value of [
    0, -0, 1, -1, 0.5, 12.345678, 792.0000000000001, 1e-7, -2.5e-12,
    1.1368683772161603e-13, 3e21, -4.2e25, 612.2834645669291,
  ])
    expect(pdfNumber(value)).toBe(numberToString(value));
});

test("draws the same operators as pdf-lib", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612.2834645669291, 792.0000000000001]);
  const image = await doc.embedJpg(JPEG.slice());
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 612.2834645669291,
    height: 792.0000000000001,
    color: rgb(1, 1, 1),
  });
  page.drawImage(image, {
    x: 12.345678,
    y: 1.1368683772161603e-13,
    width: 181.41732283464566,
    height: 252.28346456692913,
  });
  page.drawLine({
    start: { x: 10.5, y: 700.25 },
    end: { x: 10.5, y: 690.123456789 },
    thickness: 0.7086614173228347,
    color: rgb(1, 0.25098039215686274, 0.1),
  });
  const saved = await PDFDocument.load(await doc.save());
  const expected = (await pageText(saved)).replace(/Image-\d+/, "Image-7");
  expect(
    [
      ...drawRectangleOps(0, 0, 612.2834645669291, 792.0000000000001, {
        r: 1,
        g: 1,
        b: 1,
      }),
      ...drawImageOps(
        "Image-7",
        12.345678,
        1.1368683772161603e-13,
        181.41732283464566,
        252.28346456692913
      ),
      ...drawLineOps(
        { x: 10.5, y: 700.25 },
        { x: 10.5, y: 690.123456789 },
        0.7086614173228347,
        { r: 1, g: 0.25098039215686274, b: 0.1 }
      ),
    ].join("\n")
  ).toBe(expected.trim());
});

test("writes a document pdf-lib reads back with its pages and images", async () => {
  const pdf = new PdfWriter();
  const jpeg = new Blob([JPEG], { type: "image/jpeg" });
  const ref = await pdf.addJpeg(jpeg);
  for (const height of [792, 841.89])
    pdf.addPage(
      [612, height],
      drawImageOps(`Image-${ref}`, 10, 20, 30, 40),
      new Map([[`Image-${ref}`, ref]])
    );
  const bytes = new Uint8Array(await pdf.finish().arrayBuffer());
  const doc = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
  expect(doc.getPages().map((page) => page.getSize())).toEqual([
    { width: 612, height: 792 },
    { width: 612, height: 841.89 },
  ]);
  expect(await pageText(doc)).toContain(`/Image-${ref} Do`);
  const xobject = doc
    .getPages()[1]
    .node.Resources()!
    .lookup(PDFName.of("XObject")) as unknown as {
    lookup: (name: PDFName) => PDFRawStream;
  };
  const stream = xobject.lookup(PDFName.of(`Image-${ref}`));
  expect([...stream.contents]).toEqual([...JPEG]);
  expect(stream.dict.get(PDFName.of("Width"))?.toString()).toBe("2");
  expect(stream.dict.get(PDFName.of("Height"))?.toString()).toBe("1");
  expect(stream.dict.get(PDFName.of("ColorSpace"))?.toString()).toBe(
    "/DeviceRGB"
  );
});
