import { API_BASE } from "../constants";

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
  const encoded = encodeURIComponent(url);
  const proxyUrl = `${API_BASE}/images/proxy?url=${encoded}`;
  return proxyUrl;
}

export function getLocalBleedImageUrl(originalUrl: string): string {
  return toProxied(originalUrl);
}

export async function urlToDataUrl(url: string): Promise<string> {
  const proxied = toProxied(url);
  const response = await fetch(proxied);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  const blob = await response.blob();
  return await blobToDataUrl(blob);
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
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}
