import * as THREE from 'three';
import settings from '../config/settings.js';

const PARTICLES = 3;          // concurrent Zs — staggered thirds of one cycle
const LIFE = 2.1;             // seconds each Z lives before respawning
const RISE = 0.85;            // world units climbed over a lifetime
const DRIFT = 0.22;           // sideways drift over a lifetime
const SWAY_AMP = 0.07;        // amplitude of the wobble around the drift path
const SWAY_CYCLES = 1.5;      // wobble cycles per lifetime
const FADE_IN = 0.15;         // fraction of life spent fading in
const FADE_OUT = 0.35;        // fraction of life spent fading out
const BASE_SCALES = [0.26, 0.33, 0.4];
const DRIFT_DIRS = [1, -0.6, 0.8];

let sharedTexture = null;

function getZTexture() {
  if (sharedTexture) return sharedTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.font = `bold 48px ${settings.ui.fontStack}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(30,30,30,0.55)';
  ctx.strokeText('Z', size / 2, size / 2);
  ctx.fillStyle = 'rgba(235,235,235,0.95)';
  ctx.fillText('Z', size / 2, size / 2);
  sharedTexture = new THREE.CanvasTexture(canvas);
  return sharedTexture;
}

export class ZzzEffect {
  constructor() {
    const texture = getZTexture();
    this.root = new THREE.Group();
    this.root.visible = false;
    this.sprites = [];
    for (let i = 0; i < PARTICLES; i++) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      this.root.add(sprite);
      this.sprites.push(sprite);
    }
    this.t = 0;
  }

  update(dt, active) {
    if (!active) {
      this.root.visible = false;
      this.t = 0; // restart the stream from a fresh small Z next time
      return;
    }
    this.root.visible = true;
    this.t += dt;

    for (let i = 0; i < PARTICLES; i++) {
      const sprite = this.sprites[i];
      const local = this.t - (i * LIFE) / PARTICLES;
      if (local < 0) {
        sprite.visible = false;
        continue;
      }
      const p = (local % LIFE) / LIFE; // 0→1 progress through this Z's life

      sprite.visible = true;
      sprite.position.set(
        DRIFT_DIRS[i] * p * DRIFT + Math.sin(p * Math.PI * 2 * SWAY_CYCLES + i * 2.1) * SWAY_AMP,
        p * RISE,
        0
      );
      const s = BASE_SCALES[i] * (0.6 + 0.7 * p); // grows as it rises
      sprite.scale.set(s, s, 1);
      sprite.material.opacity =
        Math.min(1, p / FADE_IN) * Math.min(1, (1 - p) / FADE_OUT);
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
    for (const sprite of this.sprites) sprite.material.dispose();
  }
}
