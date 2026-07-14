import * as THREE from 'three';
import { SpriteBatch } from './SpriteBatch.js';

let sparkleTexture = null;

function getSparkleTexture() {
  if (sparkleTexture) return sparkleTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;

  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.32);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.32, 0, Math.PI * 2);
  ctx.fill();

  const spike = (w, h) => {
    const g = ctx.createLinearGradient(0, -h, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(w, 0);
    ctx.lineTo(0, h);
    ctx.lineTo(-w, 0);
    ctx.closePath();
    ctx.fill();
  };
  ctx.save();
  ctx.translate(c, c);
  spike(size * 0.05, size * 0.48); // vertical
  ctx.rotate(Math.PI / 2);
  spike(size * 0.05, size * 0.48); // horizontal
  ctx.restore();

  sparkleTexture = new THREE.CanvasTexture(canvas);
  return sparkleTexture;
}

const SPARKLE_TINTS = [
  new THREE.Color(1.0, 0.9, 0.45),
  new THREE.Color(1.0, 1.0, 1.0),
  new THREE.Color(0.6, 0.95, 1.0),
];

const MAX_BITS = 60;

export class SparkleEffects {
  constructor(sceneManager) {
    this.batch = new SpriteBatch(sceneManager, {
      texture: getSparkleTexture(),
      capacity: MAX_BITS,
      blending: THREE.AdditiveBlending, // bright, glinty accumulation
      renderOrder: 11,
    });
    this.bits = []; // live particle records, compacted in place each update
    this.free = []; // dead records, reused verbatim — spawn allocates nothing after warm-up
  }

  spawn(pos, size = 1, count = 10) {
    const y = pos.y ?? 0.9;
    for (let i = 0; i < count; i++) {
      if (this.bits.length >= MAX_BITS) return; // budget spent — drop the overflow
      const tint = SPARKLE_TINTS[(Math.random() * SPARKLE_TINTS.length) | 0];
      const b = this.free.pop() ?? {};
      b.r = tint.r;
      b.g = tint.g;
      b.b = tint.b;
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
      const r = (0.1 + Math.random() * 0.35) * size;
      b.x = pos.x + Math.cos(a) * r;
      b.y = y + (Math.random() - 0.1) * 0.4 * size;
      b.z = pos.z + Math.sin(a) * r;
      b.age = 0;
      b.life = 0.5 + Math.random() * 0.35;
      b.s0 = (0.32 + Math.random() * 0.3) * size;
      const speed = (2.2 + Math.random() * 2.6) * size;
      b.vx = Math.cos(a) * speed;
      b.vy = (2.0 + Math.random() * 2.4) * size;
      b.vz = Math.sin(a) * speed;
      b.twinkle = 12 + Math.random() * 16; // per-particle flicker rate
      b.phase = Math.random() * Math.PI * 2;
      this.bits.push(b);
    }
  }

  update(dt) {
    const gravity = 9.5;
    const bits = this.bits;
    let w = 0; // survivors compact to the front; batch slot == survivor index
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i];
      b.age += dt;
      if (b.age >= b.life) {
        this.free.push(b);
        continue;
      }
      const t = b.age / b.life;
      b.vy -= gravity * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      const flicker = 0.55 + 0.45 * Math.sin(b.phase + b.age * b.twinkle);
      this.batch.set(w, b.x, b.y, b.z, b.s0 * (1 - 0.35 * t), b.r, b.g, b.b, (1 - t * t) * flicker);
      bits[w++] = b;
    }
    bits.length = w;
    this.batch.commit(w);
  }
}
