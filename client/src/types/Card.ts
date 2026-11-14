import type { BleedArtworkOptions } from "../helpers/bleedArtwork";

export interface CardFace {
  name: string;
  imageUrl: string;
  thumbUrl?: string;
  faceIndex: number;
}

export interface CardOption {
  uuid: string;
  name: string;
  imageUrls: string[];
  isUserUpload: boolean;
  hasBakedBleed?: boolean;
  hasBackImage?: boolean;
  backHasBakedBleed?: boolean;
  query?: { name: string; set?: string; number?: string };
  set?: string;
  number?: string;
  lang?: string;
  layout?: string;
  faces?: CardFace[];
  currentFaceIndex?: number;
  bleedArtwork?: Partial<BleedArtworkOptions>;
}

export interface CardDimensions {
  width: number;
  height: number;
  widthWithBakedBleed: number;
  heightWithBakedBleed: number;
  bleedSize: number;
}
