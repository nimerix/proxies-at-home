import type { CardDimensions } from "./types/Card";

const fromEnv = (import.meta as any)?.env?.VITE_API_BASE as string | undefined;

export const API_BASE =
  (fromEnv && fromEnv.replace(/\/$/, "")) ||
  (import.meta.env.DEV ? "http://localhost:3001" : "");

// Helper to safely prefix with API_BASE (or keep relative)
export const apiUrl = (path: string) => {
  const base = API_BASE?.replace(/\/+$/, "") || "";
  const cleanPath = path.replace(/^\/+/, "");
  return base ? `${base}/${cleanPath}` : `/${cleanPath}`;
};

export const CARD_H_MM = 88;
export const CARD_W_MM = 63;
export const CARD_H_MM_WITH_MPC_BLEED = 94; // 3mm bleed top/bottom
export const CARD_W_MM_WITH_MPC_BLEED = 69; // 3mm bleed left/right

export const DPI_MM_RECIP = 0.03937008;

export const LANGUAGE_OPTIONS = [
    { code: "en", label: "English" },
    { code: "es", label: "Español" },
    { code: "fr", label: "Français" },
    { code: "de", label: "Deutsch" },
    { code: "it", label: "Italiano" },
    { code: "pt", label: "Português" },
    { code: "ja", label: "日本語" },
    { code: "ko", label: "한국어" },
    { code: "ru", label: "Русский" },
    { code: "zhs", label: "简体中文" },
    { code: "zht", label: "繁體中文" },
  ];

export const pixelDPIMap: Map<number, CardDimensions> = new Map([
  [300, {
    width: Math.round(DPI_MM_RECIP * 300 * CARD_W_MM),
    height: Math.round(DPI_MM_RECIP * 300 * CARD_H_MM),
    widthWithBakedBleed: Math.round(DPI_MM_RECIP * 300 * CARD_W_MM_WITH_MPC_BLEED),
    heightWithBakedBleed: Math.round(DPI_MM_RECIP * 300 * CARD_H_MM_WITH_MPC_BLEED),
    bleedSize: Math.round(DPI_MM_RECIP * 300 * 3), // 3mm bleed
  }],
  [330, {
    width: Math.round(DPI_MM_RECIP * 330* CARD_W_MM),
    height: Math.round(DPI_MM_RECIP * 330 * CARD_H_MM),
    widthWithBakedBleed: Math.round(DPI_MM_RECIP * 330 * CARD_W_MM_WITH_MPC_BLEED),
    heightWithBakedBleed: Math.round(DPI_MM_RECIP * 330 * CARD_H_MM_WITH_MPC_BLEED),
    bleedSize: Math.round(DPI_MM_RECIP * 330 * 3), // 3mm bleed
  }],
  [460, {
    width: Math.round(DPI_MM_RECIP * 460 * CARD_W_MM),
    height: Math.round(DPI_MM_RECIP * 460 * CARD_H_MM),
    widthWithBakedBleed: Math.round(DPI_MM_RECIP * 460 * CARD_W_MM_WITH_MPC_BLEED),
    heightWithBakedBleed: Math.round(DPI_MM_RECIP * 460 * CARD_H_MM_WITH_MPC_BLEED),
    bleedSize: Math.round(DPI_MM_RECIP * 460 * 3), // 3mm bleed
  }],
  [600, {
    width: Math.round(DPI_MM_RECIP * 600 * CARD_W_MM),
    height: Math.round(DPI_MM_RECIP * 600 * CARD_H_MM),
    widthWithBakedBleed: Math.round(DPI_MM_RECIP * 600 * CARD_W_MM_WITH_MPC_BLEED),
    heightWithBakedBleed: Math.round(DPI_MM_RECIP * 600 * CARD_H_MM_WITH_MPC_BLEED),
    bleedSize: Math.round(DPI_MM_RECIP * 600 * 3), // 3mm bleed
  }],
  [800, {
    width: Math.round(DPI_MM_RECIP * 800 * CARD_W_MM),
    height: Math.round(DPI_MM_RECIP * 800 * CARD_H_MM),
    widthWithBakedBleed: Math.round(DPI_MM_RECIP * 800 * CARD_W_MM_WITH_MPC_BLEED),
    heightWithBakedBleed: Math.round(DPI_MM_RECIP * 800 * CARD_H_MM_WITH_MPC_BLEED),
    bleedSize: Math.round(DPI_MM_RECIP * 800 * 3), // 3mm bleed
  }],
  [900, {
    width: Math.round(DPI_MM_RECIP * 900 * CARD_W_MM),
    height: Math.round(DPI_MM_RECIP * 900 * CARD_H_MM),
    widthWithBakedBleed: Math.round(DPI_MM_RECIP * 900 * CARD_W_MM_WITH_MPC_BLEED),
    heightWithBakedBleed: Math.round(DPI_MM_RECIP * 900 * CARD_H_MM_WITH_MPC_BLEED),
    bleedSize: Math.round(DPI_MM_RECIP * 900 * 3), // 3mm bleed
  }],
  [1200, {
    width: Math.round(DPI_MM_RECIP * 1200 * CARD_W_MM),
    height: Math.round(DPI_MM_RECIP * 1200 * CARD_H_MM),
    widthWithBakedBleed: Math.round(DPI_MM_RECIP * 1200 * CARD_W_MM_WITH_MPC_BLEED),
    heightWithBakedBleed: Math.round(DPI_MM_RECIP * 1200 * CARD_H_MM_WITH_MPC_BLEED),
    bleedSize: Math.round(DPI_MM_RECIP * 1200 * 3), // 3mm bleed
  }],
]);