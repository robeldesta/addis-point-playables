// One small layer between our games and wherever they run.
// On YouTube Playables it talks to the official `ytgame` SDK.
// Anywhere else (GitHub Pages, local dev) it falls back to the browser.
// Games must only use this module for saving, pausing, audio and language,
// because Playables certification forbids using the browser APIs directly.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    ytgame?: any;
  }
}

type Listener = () => void;

const yt = (): any | undefined =>
  window.ytgame && window.ytgame.IN_PLAYABLES_ENV ? window.ytgame : undefined;

export const isPlayables = (): boolean => yt() !== undefined;

const pauseListeners: Listener[] = [];
const resumeListeners: Listener[] = [];
const audioListeners: ((enabled: boolean) => void)[] = [];

let initialized = false;

export function initPlatform(): void {
  if (initialized) return;
  initialized = true;
  const sdk = yt();
  if (sdk) {
    sdk.system.onPause(() => pauseListeners.forEach((f) => f()));
    sdk.system.onResume(() => resumeListeners.forEach((f) => f()));
    sdk.system.onAudioEnabledChange((on: boolean) =>
      audioListeners.forEach((f) => f(on)),
    );
  } else {
    // Off-platform only: use page visibility to pause.
    document.addEventListener("visibilitychange", () => {
      (document.hidden ? pauseListeners : resumeListeners).forEach((f) => f());
    });
  }
}

/** Call once, when the first frame has rendered (loading screen is fine). */
export function firstFrameReady(): void {
  yt()?.game.firstFrameReady();
}

/** Call exactly once, when the player can actually interact. */
export function gameReady(): void {
  yt()?.game.gameReady();
}

export const onPause = (f: Listener) => pauseListeners.push(f);
export const onResume = (f: Listener) => resumeListeners.push(f);
export const onAudioChange = (f: (enabled: boolean) => void) =>
  audioListeners.push(f);

export function isAudioEnabled(): boolean {
  const sdk = yt();
  return sdk ? sdk.system.isAudioEnabled() : true;
}

const LOCAL_KEY = (game: string) => `addis-point:${game}`;

/** Load the saved state as a string ("" when there is none). */
export async function loadSave(game: string): Promise<string> {
  const sdk = yt();
  if (sdk) {
    try {
      return (await sdk.game.loadData()) ?? "";
    } catch {
      return "";
    }
  }
  try {
    return window.localStorage.getItem(LOCAL_KEY(game)) ?? "";
  } catch {
    return "";
  }
}

/** Save state. Keep it small: Playables allows up to 3 MiB, aim for < 500 KiB. */
export async function save(game: string, data: string): Promise<void> {
  const sdk = yt();
  if (sdk) {
    try {
      await sdk.game.saveData(data);
    } catch (e) {
      console.warn("saveData failed", e);
    }
    return;
  }
  try {
    window.localStorage.setItem(LOCAL_KEY(game), data);
  } catch {
    /* storage blocked: game still works, just doesn't persist */
  }
}

/** Report the player's best score (must match what is in the save). */
export function sendScore(value: number): void {
  yt()?.engagement.sendScore({ value: Math.floor(value) });
}

/** BCP-47 language code, e.g. "en". */
export async function getLanguage(): Promise<string> {
  const sdk = yt();
  if (sdk) {
    try {
      return await sdk.system.getLanguage();
    } catch {
      return "en";
    }
  }
  return navigator.language || "en";
}
