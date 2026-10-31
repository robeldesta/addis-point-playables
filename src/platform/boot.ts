import Phaser from "phaser";
import {
  initPlatform,
  firstFrameReady,
  onPause,
  onResume,
  onAudioChange,
  isAudioEnabled,
} from "./platform";

// Shared Phaser setup for every game.
// - FIT scaling on a portrait 720x1280 canvas, so any aspect ratio from
//   9:32 to 32:9 letterboxes cleanly instead of breaking.
// - Pause / resume / mute wired to the platform, as Playables requires.
export function bootGame(scenes: Phaser.Types.Scenes.SceneType[]): Phaser.Game {
  initPlatform();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#1d1a16",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 720,
      height: 1280,
    },
    // Phaser's own pause-on-blur must be off; the platform decides.
    autoFocus: false,
    scene: scenes,
    callbacks: {
      postBoot: (g) => {
        g.sound.mute = !isAudioEnabled();
        firstFrameReady();
      },
    },
  });

  game.events.on(Phaser.Core.Events.READY, () => {
    // Stop Phaser pausing itself on hidden tabs; the platform handles it.
    game.events.off(Phaser.Core.Events.HIDDEN);
    game.events.off(Phaser.Core.Events.VISIBLE);
  });

  onPause(() => {
    game.sound.pauseAll();
    game.loop.sleep();
  });
  onResume(() => {
    game.loop.wake();
    game.sound.resumeAll();
  });
  onAudioChange((on) => {
    game.sound.mute = !on;
  });

  return game;
}
