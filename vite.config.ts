import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  build: {
    rollupOptions: {
      input: {
        popup: "src/popup/index.html",
        offscreen: "src/offscreen/index.html",
      },
      output: {
        // Emit WASM files at the extension root without a hash so that
        // ort-wasm-simd-threaded.jsep.mjs (loaded from the root) can find
        // ort-wasm-simd-threaded.jsep.wasm via import.meta.url.
        assetFileNames: (info) =>
          info.name?.endsWith(".wasm")
            ? "[name][extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },
});
