import Phaser from "phaser";
import { CROPS, Crop } from "./logic";

// All art is drawn in code, so the game has no image files to download.

function draw(scene: Phaser.Scene, key: string, w: number, h: number, fn: (g: Phaser.GameObjects.Graphics) => void) {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  fn(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

function leaves(g: Phaser.GameObjects.Graphics, color: number, cx: number, cy: number, s = 1) {
  g.fillStyle(color);
  g.fillEllipse(cx - 12 * s, cy, 22 * s, 40 * s);
  g.fillEllipse(cx + 12 * s, cy, 22 * s, 40 * s);
  g.fillEllipse(cx, cy - 8 * s, 18 * s, 44 * s);
}

function ripe(g: Phaser.GameObjects.Graphics, c: Crop) {
  const cx = 50, cy = 56;
  switch (c.id) {
    case "wheat":
      g.fillStyle(0xb8962e);
      for (let i = -2; i <= 2; i++) g.fillRect(cx + i * 12 - 2, cy - 10, 4, 50);
      g.fillStyle(c.color);
      for (let i = -2; i <= 2; i++) g.fillEllipse(cx + i * 12, cy - 20 - Math.abs(i) * -4, 12, 34);
      break;
    case "carrot":
      leaves(g, c.leaf, cx, cy - 30, 0.8);
      g.fillStyle(c.color);
      g.fillTriangle(cx - 20, cy - 12, cx + 20, cy - 12, cx, cy + 40);
      break;
    case "corn":
      leaves(g, c.leaf, cx, cy + 6, 1.1);
      g.fillStyle(c.color);
      g.fillEllipse(cx, cy - 6, 30, 66);
      g.fillStyle(0xf9a825);
      for (let y = -30; y < 22; y += 10) g.fillRect(cx - 12, cy + y, 24, 2);
      break;
    case "pumpkin":
      g.fillStyle(c.leaf);
      g.fillRect(cx - 4, cy - 40, 8, 16);
      g.fillStyle(c.color);
      g.fillEllipse(cx - 18, cy + 4, 40, 54);
      g.fillEllipse(cx + 18, cy + 4, 40, 54);
      g.fillEllipse(cx, cy + 4, 40, 58);
      break;
    case "coffee":
      leaves(g, c.leaf, cx, cy, 1.1);
      g.fillStyle(c.color);
      for (const [dx, dy] of [[-14, -6], [0, -14], [14, -4], [-8, 10], [8, 12], [0, 0]]) g.fillCircle(cx + dx, cy + dy, 9);
      break;
    case "berry":
      leaves(g, c.leaf, cx, cy - 18, 0.8);
      g.fillStyle(c.color);
      g.fillTriangle(cx - 24, cy - 6, cx + 24, cy - 6, cx, cy + 38);
      g.fillCircle(cx, cy - 4, 24);
      g.fillStyle(0xffeb3b);
      for (const [dx, dy] of [[-10, 0], [8, -6], [0, 12], [-4, 24], [12, 10]]) g.fillCircle(cx + dx, cy + dy, 2);
      break;
    default: // tomato
      leaves(g, c.leaf, cx, cy - 16, 0.9);
      g.fillStyle(c.color);
      g.fillCircle(cx, cy + 8, 26);
      g.fillStyle(0xffffff, 0.35);
      g.fillCircle(cx - 9, cy - 1, 7);
  }
}

export function makeArt(scene: Phaser.Scene) {
  for (const c of CROPS) {
    draw(scene, `ripe-${c.id}`, 100, 100, (g) => ripe(g, c));
    draw(scene, `grow-${c.id}`, 100, 100, (g) => leaves(g, c.leaf, 50, 62, 0.85));
  }
  draw(scene, "sprout", 100, 100, (g) => {
    g.fillStyle(0x7cb342);
    g.fillEllipse(42, 70, 14, 24);
    g.fillEllipse(58, 70, 14, 24);
  });
  draw(scene, "coin", 48, 48, (g) => {
    g.fillStyle(0xc99a1e);
    g.fillCircle(24, 24, 22);
    g.fillStyle(0xf5c542);
    g.fillCircle(24, 24, 17);
    g.fillStyle(0xfff3c4, 0.7);
    g.fillCircle(18, 18, 5);
  });
  draw(scene, "lock", 40, 48, (g) => {
    g.lineStyle(6, 0xd7ccc8);
    g.strokeCircle(20, 18, 11);
    g.fillStyle(0xd7ccc8);
    g.fillRoundedRect(4, 20, 32, 26, 6);
  });
  draw(scene, "customer", 120, 140, (g) => {
    g.fillStyle(0x5c6bc0);
    g.fillRoundedRect(20, 70, 80, 70, 24);
    g.fillStyle(0xa1887f);
    g.fillCircle(60, 44, 32);
    g.fillStyle(0x3e2723);
    g.fillCircle(48, 40, 4);
    g.fillCircle(72, 40, 4);
    g.lineStyle(4, 0x3e2723);
    g.beginPath();
    g.arc(60, 50, 12, 0.2, Math.PI - 0.2);
    g.strokePath();
  });
}
