import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Tauri expects a fixed port for the dev server.
// TAURI_DEV_HOST is set by `tauri dev` when using a mobile target.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],

  // Path alias so we can import as `@/components/...`
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Prevent vite from obscuring Rust errors
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      // Tell vite to ignore watching `src-tauri` — cargo handles that.
      ignored: ["**/src-tauri/**"],
    },
  },
});
