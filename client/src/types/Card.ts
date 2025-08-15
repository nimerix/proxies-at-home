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
