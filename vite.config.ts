import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    cssTarget: "safari16",
    assetsInlineLimit: 2048,
    rollupOptions: {
      output: {
        entryFileNames: "a/[hash].js",
        chunkFileNames: "a/[hash].js",
        assetFileNames: "a/[hash].[ext]",
      },
    },
  },
});
