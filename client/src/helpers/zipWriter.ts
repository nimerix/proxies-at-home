// Stored (uncompressed) ZIP built as a Blob of parts, so file data is never
// copied into script memory. Image files are already compressed.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++)
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

const MAX_SIZE = 0xffffffff;
const encoder = new TextEncoder();

function dosDateTime(date: Date) {
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date:
      ((Math.max(1980, date.getFullYear()) - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

export class ZipWriter {
  private parts: BlobPart[] = [];
  private central: Uint8Array<ArrayBuffer>[] = [];
  private offset = 0;
  private stamp = dosDateTime(new Date());

  add(name: string, data: Blob, crc: number) {
    const path = encoder.encode(name);
    if (data.size > MAX_SIZE || this.offset + data.size > MAX_SIZE)
      throw new Error(
        "These images are too large for one ZIP. Export fewer cards at a time."
      );
    const local = new Uint8Array(30 + path.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 10, true);
    view.setUint16(6, 0x0800, true); // UTF-8 names
    view.setUint16(8, 0, true); // stored
    view.setUint16(10, this.stamp.time, true);
    view.setUint16(12, this.stamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.size, true);
    view.setUint32(22, data.size, true);
    view.setUint16(26, path.length, true);
    local.set(path, 30);

    const entry = new Uint8Array(46 + path.length);
    const dir = new DataView(entry.buffer);
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 10, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, this.stamp.time, true);
    dir.setUint16(14, this.stamp.date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.size, true);
    dir.setUint32(24, data.size, true);
    dir.setUint16(28, path.length, true);
    dir.setUint32(42, this.offset, true);
    entry.set(path, 46);

    this.parts.push(local, data);
    this.central.push(entry);
    this.offset += local.length + data.size;
  }

  finish(type = "application/zip") {
    const size = this.central.reduce((sum, entry) => sum + entry.length, 0);
    if (this.central.length > 0xffff || this.offset + size > MAX_SIZE)
      throw new Error(
        "These images are too large for one ZIP. Export fewer cards at a time."
      );
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, this.central.length, true);
    view.setUint16(10, this.central.length, true);
    view.setUint32(12, size, true);
    view.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, end], { type });
  }
}
