import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles/globals.css";
import App from "./App.js";
import { useAuthStore } from "./stores/auth.store.js";

// Initialise auth from URL token / sessionStorage before render
useAuthStore.getState().init();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,      // 10 seconds
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
