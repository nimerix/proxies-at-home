export const DRIVE_ID = /^[A-Za-z0-9_-]{12,200}$/;
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20000;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
]);

export class ImageError extends Error {}

// Only follow Google's own download hosts, so the Worker cannot be pointed at
// other servers.
export function allowedDriveUrl(raw: string, base?: string | URL) {
  const url = new URL(raw, base);
  const host = url.hostname.toLowerCase();
  const google =
    host === "drive.google.com" ||
    host === "drive.usercontent.google.com" ||
    host.endsWith(".googleusercontent.com");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !google
  )
    throw new ImageError("Image URL is not an allowed source.");
  return url;
}

function limitBytes(body: ReadableStream<Uint8Array>, max: number) {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > max)
          controller.error(new ImageError("Image is larger than 30 MB."));
        else controller.enqueue(chunk);
      },
    })
  );
}

export async function fetchDriveImage(
  id: string,
  fetcher: typeof fetch = fetch
): Promise<Response> {
  let url = allowedDriveUrl(
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`
  );
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetcher(url.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": "OopsAllProxies/1.0 (https://www.oopsallproxies.com)",
        Accept: [...IMAGE_TYPES].join(","),
      },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      url = allowedDriveUrl(location, url);
      continue;
    }
    const type = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const declared = response.headers.get("content-length");
    const length = declared === null ? null : Number(declared);
    if (
      response.status !== 200 ||
      !IMAGE_TYPES.has(type) ||
      !response.body ||
      length === 0 ||
      (length !== null && !(length <= MAX_IMAGE_BYTES))
    ) {
      await response.body?.cancel();
      throw new ImageError(
        "The source did not return a supported image. Check that it is publicly accessible."
      );
    }
    const headers = new Headers({
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
    });
    if (length !== null) headers.set("Content-Length", String(length));
    return new Response(
      length === null
        ? limitBytes(response.body, MAX_IMAGE_BYTES)
        : response.body,
      { headers }
    );
  }
  throw new ImageError("Too many image redirects.");
}
