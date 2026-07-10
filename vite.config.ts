import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

export default defineConfig({
  // Debug tab is included in normal builds (load-unpacked dev) and stripped
  // only when YTTA_PROD=1 (the `npm run package` zip build for the store).
  define: {
    __SHOW_DEBUG__: JSON.stringify(process.env.YTTA_PROD !== "1"),
  },
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
