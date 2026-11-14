import { create } from "zustand";

export type Notice = {
  id: number;
  message: string;
  kind: "success" | "error" | "info";
};
let nextId = 0;
export const useNotifications = create<{
  notices: Notice[];
  notify: (message: string, kind?: Notice["kind"]) => void;
  dismiss: (id: number) => void;
}>((set) => ({
  notices: [],
  notify: (message, kind = "info") =>
    set((s) => ({
      notices: [...s.notices.slice(-1), { id: ++nextId, message, kind }],
    })),
  dismiss: (id) =>
    set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
}));
export const notify = (message: string, kind: Notice["kind"] = "info") =>
  useNotifications.getState().notify(message, kind);
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
