import * as THREE from 'three';

/**
 * ZzzEffect — a persistent "Zzz" sprite hovering above a worker's head while
 * it's asleep on break. Purely render-side eye-candy (Mechanic.js /
 * MarketWorker.js own no game state); toggled by update(dt, active).
 *
 * The "Zzz" texture is a module-level singleton: one CanvasTexture drawn once
 * and shared by every instance. Each instance clones the SpriteMaterial so its
 * own visibility is independent, but the texture itself is never re-created
 * and never disposed per instance.
 */

const BOB_AMPLITUDE = 0.1;
const BOB_PERIOD = 1.5; // seconds per full up/down cycle

let sharedTexture = null;

/** Build (once) a bold "Zzz" glyph, light grey with a dark outline for contrast. */
function getZzzTexture() {
  if (sharedTexture) return sharedTexture;
  const w = 96;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 40px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(30,30,30,0.55)';
  ctx.strokeText('Zzz', w / 2, h / 2);
  ctx.fillStyle = 'rgba(235,235,235,0.95)';
  ctx.fillText('Zzz', w / 2, h / 2);
  sharedTexture = new THREE.CanvasTexture(canvas);
  return sharedTexture;
}

export class ZzzEffect {
  constructor() {
    const texture = getZzzTexture();
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    this.sprite = new THREE.Sprite(material);
    this.sprite.scale.set(0.9, 0.6, 1);
    this.sprite.visible = false;
    this.baseY = null; // captured lazily from whatever y the caller positions the sprite at
    this.t = 0;
  }

  update(dt, active) {
    this.sprite.visible = active;
    if (this.baseY === null) this.baseY = this.sprite.position.y;
    if (!active) return;

    this.t += dt;
    const phase = (this.t / BOB_PERIOD) * Math.PI * 2;
    this.sprite.position.y = this.baseY + Math.sin(phase) * BOB_AMPLITUDE;
  }

  dispose() {
    this.sprite.parent?.remove(this.sprite);
    this.sprite.material.dispose();
  }
}
