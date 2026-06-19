import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("maplibre-gl")) {
            return "map";
          }

          if (id.includes("react") || id.includes("react-dom")) {
            return "react";
          }

          if (id.includes("lucide-react")) {
            return "icons";
          }

          return "vendor";
        }
      }
    }
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_PUBLIC_URL ?? "http://localhost:8328",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
