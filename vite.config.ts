import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

// Standard local Node build; no hosted builder or cloud deployment is required.
export default defineConfig({
  server: { host: "127.0.0.1", port: 8080, strictPort: true },
  preview: { host: "127.0.0.1", port: 8080, strictPort: true },
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart({ server: { entry: "server" } }),
    nitro({ preset: "node-server" }),
    react(),
  ],
});
