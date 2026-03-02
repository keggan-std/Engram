import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7432",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:7432",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:7432",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react":   ["react", "react-dom"],
          "vendor-tanstack": [
            "@tanstack/react-query",
            "@tanstack/react-table",
            "@tanstack/react-virtual",
          ],
          "vendor-charts":  ["recharts"],
          "vendor-ui":      ["cmdk", "lucide-react"],
          "vendor-utils":   ["date-fns", "zustand"],
        },
      },
    },
  },
});
