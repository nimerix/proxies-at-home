/**
 * Custom error types for better error handling and debugging
 */

export class ImageProcessingError extends Error {
  cardName?: string;
  source?: string;

  constructor(message: string, cardName?: string, source?: string) {
    super(message);
    this.name = "ImageProcessingError";
    this.cardName = cardName;
    this.source = source;
  }
}

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

export class AbortError extends Error {
  constructor(message: string = "Operation was aborted") {
    super(message);
    this.name = "AbortError";
  }
}

export class TimeoutError extends Error {
  timeoutMs?: number;

  constructor(message: string, timeoutMs?: number) {
    super(message);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class PDFGenerationError extends Error {
  pageNumber?: number;

  constructor(message: string, pageNumber?: number) {
    super(message);
    this.name = "PDFGenerationError";
    this.pageNumber = pageNumber;
  }
}

/**
 * Type guard to check if an error is an AbortError
 */
export function isAbortError(error: unknown): error is AbortError | DOMException {
  if (error instanceof AbortError) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return (error as any)?.name === "AbortError";
}

/**
 * Type guard to check if an error is a network-related error
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError ||
         (error instanceof TypeError && error.message.includes("fetch"));
}

/**
 * Safely extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unknown error occurred";
}

/**
 * Format error for logging with context
 */
export function formatErrorForLogging(error: unknown, context?: Record<string, unknown>): string {
  const message = getErrorMessage(error);
  const name = error instanceof Error ? error.name : "UnknownError";
  const contextStr = context ? ` | Context: ${JSON.stringify(context)}` : "";
  return `[${name}] ${message}${contextStr}`;
}
