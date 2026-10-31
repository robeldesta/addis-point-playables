import { defineConfig } from "vite";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Every folder in games/ with an index.html becomes its own page,
// so each game gets its own URL: /games/<name>/
const games = readdirSync("games", { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

export default defineConfig({
  base: "./", // Playables require relative paths
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000, // Phaser is ~360 KB gzipped, far under the 15 MiB target
    rollupOptions: {
      input: Object.fromEntries([
        ["index", resolve("index.html")],
        ...games.map((g) => [g, resolve(`games/${g}/index.html`)]),
      ]),
    },
  },
});
