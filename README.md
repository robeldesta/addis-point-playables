# Addis Point Playables

Small web games built for YouTube Playables, using Vite + TypeScript. Market Garden uses Three.js (3D); the hello test uses Phaser 4.

## Run locally

    npm install
    npm run dev        # open the printed URL, then /games/<name>/

## Add a game

Copy `games/hello/` to `games/<new-name>/`, then link it from `index.html`.
Every folder in `games/` builds to its own page at `/games/<name>/`.

## Playables rules baked in

- `src/platform/platform.ts` is the only place that talks to YouTube's `ytgame` SDK
  (save/load, pause/resume, mute, score, language). Off YouTube it falls back to the browser.
  Games must not use `localStorage`, `navigator.language` or page visibility directly.
- `src/platform/boot.ts` sets up a 720x1280 portrait canvas with FIT scaling,
  so every aspect ratio from 9:32 to 32:9 letterboxes cleanly.
- Call `gameReady()` exactly once, when the player can interact.
- No external network calls, relative paths only, no in-game mute button,
  initial download under 15 MiB (Phaser itself is ~360 KB gzipped).

## Hosting

Pushing to `main` deploys `dist/` to GitHub Pages via `.github/workflows/pages.yml`.
