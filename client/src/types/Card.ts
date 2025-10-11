export interface CardOption {
  uuid: string;
  name: string;
  imageUrls: string[];
  isUserUpload: boolean;
  hasBakedBleed?: boolean;
  set?: string;
  number?: string;
  lang?: string;
}

export interface CardDimensions {
  width: number;
  height: number;
  widthWithBakedBleed: number;
  heightWithBakedBleed: number;
  bleedSize: number;
}