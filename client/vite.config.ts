import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.API_TARGET ?? "http://localhost:3001";

// In dev, forward /api and /ws to the Express server so the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": target,
      "/ws": { target, ws: true },
    },
  },
});
