export class ImageLoadError extends Error {
  url?: string;
  statusCode?: number;

  constructor(message: string, url?: string, statusCode?: number) {
    super(message);
    this.name = "ImageLoadError";
    this.url = url;
    this.statusCode = statusCode;
  }
}

export class NetworkError extends Error {
  url?: string;
  statusCode?: number;

  constructor(message: string, url?: string, statusCode?: number) {
    super(message);
    this.name = "NetworkError";
    this.url = url;
    this.statusCode = statusCode;
  }
}
