const env = (import.meta as any).env || {};

export const API_BASE =
  env.VITE_API_BASE || (env.DEV ? "http://localhost:3001" : "");