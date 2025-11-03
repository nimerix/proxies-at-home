export interface CardFace {
  name: string;
  imageUrl: string;
  faceIndex: number;
}

export interface CardOption {
  uuid: string;
  name: string;
  imageUrls: string[];
  isUserUpload: boolean;
  hasBakedBleed?: boolean;
  set?: string;
  number?: string;
  lang?: string;
  layout?: string;
  faces?: CardFace[];
  currentFaceIndex?: number;
}

export interface CardDimensions {
  width: number;
  height: number;
  widthWithBakedBleed: number;
  heightWithBakedBleed: number;
  bleedSize: number;
}