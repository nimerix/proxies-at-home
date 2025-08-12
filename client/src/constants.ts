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