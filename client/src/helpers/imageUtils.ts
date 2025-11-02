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

export function revokeIfBlobUrl(value?: string | null) {
  if (!value || !value.startsWith("blob:")) return;
  try {
    URL.revokeObjectURL(value);
  } catch {
    /* noop */
  }
}

export function toProxied(url: string) {
  if (!url) return url;
  if (url.startsWith("data:") || url.startsWith("blob:") || isUploadedFileToken(url)) return url;
  const prefix = `${API_BASE}/api/cards/images/proxy?url=`;
  if (url.startsWith(prefix)) return url;
  return `${prefix}${encodeURIComponent(url)}`;
}

export function getLocalBleedImageUrl(originalUrl: string): string {
  return toProxied(originalUrl);
}

export async function urlToDataUrl(url: string): Promise<string> {
  const proxied = toProxied(url);
  try {
    const response = await fetch(proxied);
    if (!response.ok) {
      throw new NetworkError(
        `Failed to fetch image: ${response.statusText}`,
        proxied,
        response.status
      );
    }
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    throw new NetworkError(`Network error fetching image: ${(error as Error).message}`, proxied);
  }
}

export function pngToNormal(pngUrl: string) {
  if (!pngUrl || typeof pngUrl !== "string") return pngUrl;
  if (pngUrl.includes("?format=image")) {
    return pngUrl.replace(/[?&]format=image(&|$)/, "$1").replace(/[?&]$/, "");
  }
  return pngUrl;
}

export async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

export function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(src)) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageLoadError(`Failed to load image`, src));
    img.src = src;
  });
}

/**
 * Enhanced image loader that fetches HTTP(S) URLs to blob first to avoid CORS tainting.
 * Useful for PDF generation and other scenarios requiring canvas pixel manipulation.
 */
export async function loadImageWithBlobFetch(src: string): Promise<HTMLImageElement> {
  // If it's an http(s) URL, fetch to a blob first to avoid tainting
  if (/^https?:\/\//i.test(src)) {
    try {
      const resp = await fetch(src, { mode: "cors", credentials: "omit" });
      if (!resp.ok) {
        throw new NetworkError(`Failed to fetch image: ${resp.status}`, src, resp.status);
      }
      const blob = await resp.blob();
      src = URL.createObjectURL(blob);
    } catch (error) {
      if (error instanceof NetworkError) throw error;
      throw new NetworkError(`Network error fetching image: ${(error as Error).message}`, src);
    }
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageLoadError(`Failed to load image`, src));
    img.src = src;
  });
}
