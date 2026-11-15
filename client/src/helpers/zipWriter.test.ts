import { expect, test } from "vitest";
import JSZip from "jszip";
import { crc32, ZipWriter } from "./zipWriter";

test("computes the standard CRC-32", () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array())).toBe(0);
});

test("writes stored files that JSZip reads back with valid checksums", async () => {
  const files = [
    ["001 - Sol Ring.png", new Uint8Array([137, 80, 78, 71, 1, 2, 3])],
    ["002 - Lim-Dûl’s Vault (2).jpg", new Uint8Array(70000).fill(7)],
  ] as const;
  const zip = new ZipWriter();
  for (const [name, bytes] of files)
    zip.add(name, new Blob([bytes]), crc32(bytes));
  const blob = zip.finish();
  expect(blob.type).toBe("application/zip");
  const read = await JSZip.loadAsync(await blob.arrayBuffer(), {
    checkCRC32: true,
  });
  expect(Object.keys(read.files)).toEqual(files.map(([name]) => name));
  for (const [name, bytes] of files)
    expect(await read.file(name)!.async("uint8array")).toEqual(bytes);
});
