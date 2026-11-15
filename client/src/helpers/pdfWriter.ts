// Writes PDFs as a Blob of parts, so embedded JPEGs are never copied into
// script memory. Drawing operators match pdf-lib's output for the same calls.

export type PdfColor = { r: number; g: number; b: number };
export type PdfPoint = { x: number; y: number };

/** Decimal without exponents, like pdf-lib's numberToString. */
export function pdfNumber(value: number) {
  let text = String(value);
  if (Math.abs(value) < 1) {
    const exponent = parseInt(value.toString().split("e-")[1]);
    if (exponent) {
      const negative = value < 0;
      const scaled = Math.abs(value) * Math.pow(10, exponent - 1);
      text =
        (negative ? "-0." : "0.") +
        new Array(exponent).join("0") +
        scaled.toString().substring(2);
    }
  } else {
    let exponent = parseInt(value.toString().split("+")[1]);
    if (exponent > 20) {
      exponent -= 20;
      text =
        (value / Math.pow(10, exponent)).toString() +
        new Array(exponent + 1).join("0");
    }
  }
  return text;
}

const n = (...values: number[]) => values.map(pdfNumber).join(" ");

export function drawRectangleOps(
  x: number,
  y: number,
  width: number,
  height: number,
  color: PdfColor
) {
  return [
    "q",
    `${n(color.r, color.g, color.b)} rg`,
    "0 w",
    "[] 0 d",
    `1 0 0 1 ${n(x, y)} cm`,
    "1 0 0 1 0 0 cm",
    "1 0 0 1 0 0 cm",
    "0 0 m",
    `0 ${n(height)} l`,
    `${n(width, height)} l`,
    `${n(width)} 0 l`,
    "h",
    "f",
    "Q",
  ];
}

export function drawImageOps(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number
) {
  return [
    "q",
    `1 0 0 1 ${n(x, y)} cm`,
    "1 0 0 1 0 0 cm",
    `${n(width)} 0 0 ${n(height)} 0 0 cm`,
    "1 0 0 1 0 0 cm",
    `/${name} Do`,
    "Q",
  ];
}

export function drawLineOps(
  start: PdfPoint,
  end: PdfPoint,
  thickness: number,
  color: PdfColor
) {
  return [
    "q",
    `${n(color.r, color.g, color.b)} RG`,
    `${n(thickness)} w`,
    "[] 0 d",
    `${n(start.x, start.y)} m`,
    `${n(start.x, start.y)} m`,
    `${n(end.x, end.y)} l`,
    "S",
    "Q",
  ];
}

const COLOR_SPACES: Record<number, string> = {
  1: "/DeviceGray",
  3: "/DeviceRGB",
  4: "/DeviceCMYK",
};

/** Width, height and channels from a JPEG's start-of-frame marker. */
async function jpegInfo(blob: Blob) {
  for (let length = 65536; ; length *= 4) {
    const bytes = new Uint8Array(await blob.slice(0, length).arrayBuffer());
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
      throw new Error("The rendered card is not a JPEG image.");
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) throw new Error("The rendered JPEG is invalid.");
      const marker = bytes[at + 1];
      if (marker === 0xff) {
        at++;
        continue;
      }
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      )
        return {
          bitsPerComponent: bytes[at + 4],
          height: (bytes[at + 5] << 8) | bytes[at + 6],
          width: (bytes[at + 7] << 8) | bytes[at + 8],
          channels: bytes[at + 9],
        };
      at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
    }
    if (length >= blob.size)
      throw new Error("The rendered JPEG has no image size.");
  }
}

export class PdfWriter {
  private parts: BlobPart[] = [];
  private size = 0;
  private offsets: number[] = [0];
  private pages: number[] = [];
  private catalog = this.reserve();
  private pageTree = this.reserve();

  constructor() {
    this.write("%PDF-1.7\n");
    this.write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  }

  private reserve() {
    this.offsets.push(0);
    return this.offsets.length - 1;
  }

  // Text parts are ASCII, so their length in bytes is their string length.
  private write(part: string | Uint8Array<ArrayBuffer> | Blob) {
    this.parts.push(part);
    this.size +=
      typeof part === "string"
        ? part.length
        : part instanceof Blob
          ? part.size
          : part.byteLength;
  }

  private object(ref: number, ...body: (string | Blob)[]) {
    this.offsets[ref] = this.size;
    this.write(`${ref} 0 obj\n`);
    for (const part of body) this.write(part);
    this.write("\nendobj\n");
  }

  private stream(ref: number, dict: string, content: string | Blob) {
    const length = typeof content === "string" ? content.length : content.size;
    this.object(
      ref,
      `<<\n${dict}/Length ${length}\n>>\nstream\n`,
      content,
      "\nendstream"
    );
  }

  /** Embeds a JPEG and returns its object number. */
  async addJpeg(blob: Blob) {
    const { bitsPerComponent, width, height, channels } = await jpegInfo(blob);
    const colorSpace = COLOR_SPACES[channels];
    if (!colorSpace) throw new Error("The rendered JPEG has an unknown color.");
    const ref = this.reserve();
    this.stream(
      ref,
      "/Type /XObject\n/Subtype /Image\n" +
        `/BitsPerComponent ${bitsPerComponent}\n/Width ${width}\n/Height ${height}\n` +
        `/ColorSpace ${colorSpace}\n` +
        (channels === 4 ? "/Decode [ 1 0 1 0 1 0 1 0 ]\n" : "") +
        "/Filter /DCTDecode\n",
      blob
    );
    return ref;
  }

  addPage(
    size: [number, number],
    operators: string[],
    images: Map<string, number>
  ) {
    const contents = this.reserve(),
      page = this.reserve();
    this.stream(contents, "", operators.join("\n"));
    const xobjects = [...images]
      .map(([name, ref]) => `/${name} ${ref} 0 R\n`)
      .join("");
    this.object(
      page,
      `<<\n/Type /Page\n/Parent ${this.pageTree} 0 R\n` +
        `/Resources <<\n/XObject <<\n${xobjects}>>\n>>\n` +
        `/MediaBox [ 0 0 ${n(size[0], size[1])} ]\n/Contents ${contents} 0 R\n>>`
    );
    this.pages.push(page);
  }

  finish() {
    this.object(
      this.pageTree,
      `<<\n/Type /Pages\n/Kids [ ${this.pages.map((ref) => `${ref} 0 R`).join(" ")} ]\n/Count ${this.pages.length}\n>>`
    );
    this.object(
      this.catalog,
      `<<\n/Type /Catalog\n/Pages ${this.pageTree} 0 R\n>>`
    );
    const date = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const info = this.reserve();
    this.object(
      info,
      `<<\n/Producer (Oops, All Proxies)\n/Creator (Oops, All Proxies)\n` +
        `/CreationDate (D:${date})\n/ModDate (D:${date})\n>>`
    );
    const xref = this.size;
    this.write(
      `xref\n0 ${this.offsets.length}\n0000000000 65535 f \n` +
        this.offsets
          .slice(1)
          .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
          .join("") +
        `trailer\n<<\n/Size ${this.offsets.length}\n/Root ${this.catalog} 0 R\n/Info ${info} 0 R\n>>\n` +
        `startxref\n${xref}\n%%EOF\n`
    );
    return new Blob(this.parts, { type: "application/pdf" });
  }
}
