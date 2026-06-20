import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// Two entries: the server-only `.`/core (executeHtml + dispatch, imported by the
// host server build) and the browser `./vue` (View/Preview). `vue` +
// `gui-chat-protocol/vue` are externalised so the plugin and host share ONE
// instance (the injected PLUGIN_RUNTIME_KEY Symbol must match). Mirrors
// chart-plugin's config.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        core: resolve(__dirname, "src/core/index.ts"),
        vue: resolve(__dirname, "src/vue/index.ts"),
      },
      name: "GUIChatPluginHtml",
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: ["vue", "gui-chat-protocol", "gui-chat-protocol/vue"],
      output: {
        exports: "named",
        globals: { vue: "Vue" },
        assetFileNames: "style.[ext]",
      },
    },
    cssCodeSplit: false,
  },
});
