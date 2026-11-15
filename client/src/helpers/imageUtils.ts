import { API_BASE } from "../constants";
import { ImageLoadError, NetworkError } from "../types/errors";

const UPLOADED_FILE_TOKEN_PREFIX = "uploaded-file://" as const;

export type UploadedFileToken = `${typeof UPLOADED_FILE_TOKEN_PREFIX}${string}`;

export const makeUploadedFileToken = (uuid: string): UploadedFileToken =>
  `${UPLOADED_FILE_TOKEN_PREFIX}${uuid}`;

export const isUploadedFileToken = (
  value?: string | null
): value is UploadedFileToken =>
  typeof value === "string" && value.startsWith(UPLOADED_FILE_TOKEN_PREFIX);

// Card images load straight from Scryfall's CDN, which allows cross-origin
// reads. Only Google Drive (MPC) images go through this site's /api route.
export function resolveImageUrl(url: string) {
  if (!url) return url;
  // Saved decks keep portable /api paths; resolve the configured API origin
  // only when requesting, including paths saved by an older deployment.
  const apiPath = url.match(
    /^(?:https?:\/\/[^/]+)?(\/api\/cards\/images\/(?:front|proxy)\?.*)$/
  )?.[1];
  if (apiPath?.startsWith("/api/cards/images/front?"))
    return `${API_BASE}${apiPath}`;
  if (apiPath) {
    // Decks saved before the image proxy was removed.
    const original = new URLSearchParams(apiPath.split("?")[1]).get("url");
    return original && /^https:\/\//i.test(original) ? original : url;
  }
  return url;
}

export async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

export function loadImageElement(src: string, signal?: AbortSignal) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const img = new Image();
    if (/^https?:/i.test(src)) {
      img.crossOrigin = "anonymous";
    }
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      img.onload = null;
      img.onerror = null;
    };
    const abort = () => {
      cleanup();
      img.src = "";
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      img.src = "";
      reject(new ImageLoadError("Image timed out. Try again.", src));
    }, 30000);
    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      reject(new ImageLoadError("Failed to load image", src));
    };
    signal?.addEventListener("abort", abort, { once: true });
    img.src = src;
  });
}

/**
 * Enhanced image loader that fetches HTTP(S) URLs to blob first to avoid CORS tainting.
 * Useful for PDF generation and other scenarios requiring canvas pixel manipulation.
 */
export async function loadImageWithBlobFetch(
  src: string,
  signal?: AbortSignal
): Promise<HTMLImageElement> {
  if (/^(data:|blob:)/i.test(src)) return loadImageElement(src, signal);
  const objectUrl = URL.createObjectURL(await fetchImageBlob(src, signal));
  try {
    return await loadImageElement(objectUrl, signal);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function fetchImageBlob(src: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(30000);
  const response = await fetch(resolveImageUrl(src), {
    credentials: "omit",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok)
    throw new NetworkError(
      `Failed to fetch image: ${response.status}`,
      src,
      response.status
    );
  return response.blob();
}
