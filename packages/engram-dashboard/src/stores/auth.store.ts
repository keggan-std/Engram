import { create } from "zustand";
import { setToken, getToken } from "../api/client.js";

interface AuthState {
  token: string | null;
  isAuthed: boolean;
  init: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  isAuthed: false,
  init() {
    const t = getToken();
    if (t) {
      setToken(t);
      set({ token: t, isAuthed: true });
    }
  },
}));
