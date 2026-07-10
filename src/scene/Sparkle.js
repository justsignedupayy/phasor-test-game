import * as THREE from 'three';

/**
 * Sparkle.js — a bright "shiny / done!" glitter burst: a handful of small
 * four-point star sprites that shoot outward, arc under gravity, twinkle and
 * fade over ~0.5-0.8s, then remove themselves. Fully procedural (a glint canvas
 * texture drawn once, tinted gold/white/cyan per particle) — no external assets,
 * same approach as scene/Poof.js.
 *
 * Reusable effect: spawn(pos, size) anywhere, update(dt) once per frame from the
 * main loop. In this game it fires alongside a poof when a car finishes being
 * repaired at a pit (see scene/CarYard.js) — never at the gas station.
 */

let sparkleTexture = null;

/** The shared glint sprite texture: a soft bright core plus four diffraction
 * spikes on a canvas, so each sprite reads as a twinkling star, not a disc. */
function getSparkleTexture() {
  if (sparkleTexture) return sparkleTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;

  // Soft round core.
  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.32);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.32, 0, Math.PI * 2);
  ctx.fill();

  // Four tapered diffraction spikes (a thin bright cross that fades to the tips).
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

// A few celebratory tints the particles pick from: warm gold, white, icy cyan.
const SPARKLE_TINTS = [
  new THREE.Color(1.0, 0.9, 0.45),
  new THREE.Color(1.0, 1.0, 1.0),
  new THREE.Color(0.6, 0.95, 1.0),
];

export class SparkleEffects {
  constructor(sceneManager) {
    this.group = new THREE.Group();
    sceneManager.add(this.group);
    this.bits = [];
  }

  /**
   * Burst a sparkle shower at pos {x, y?, z} (y defaults to car mid-height);
   * `size` scales the whole burst (1 ≈ a small prop-sized celebration).
   */
  spawn(pos, size = 1) {
    const tex = getSparkleTexture();
    const count = 14;
    const y = pos.y ?? 0.9;
    for (let i = 0; i < count; i++) {
      const tint = SPARKLE_TINTS[(Math.random() * SPARKLE_TINTS.length) | 0];
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: tint,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending, // bright, glinty accumulation
      });
      const sprite = new THREE.Sprite(mat);
      // Fire out in all directions, biased slightly upward so they arc and rain.
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
      const r = (0.1 + Math.random() * 0.35) * size;
      sprite.position.set(pos.x + Math.cos(a) * r, y + (Math.random() - 0.1) * 0.4 * size, pos.z + Math.sin(a) * r);
      const s0 = (0.28 + Math.random() * 0.28) * size;
      sprite.scale.setScalar(s0);
      this.group.add(sprite);
      const speed = (2.2 + Math.random() * 2.6) * size;
      this.bits.push({
        sprite,
        age: 0,
        life: 0.5 + Math.random() * 0.35,
        s0,
        vx: Math.cos(a) * speed,
        vy: (2.0 + Math.random() * 2.4) * size,
        vz: Math.sin(a) * speed,
        twinkle: 12 + Math.random() * 16, // per-particle flicker rate
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  update(dt) {
    const gravity = 9.5;
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.age += dt;
      const t = b.age / b.life;
      if (t >= 1) {
        this.group.remove(b.sprite);
        b.sprite.material.dispose();
        this.bits.splice(i, 1);
        continue;
      }
      // Ballistic arc: gravity pulls the upward toss back down.
      b.vy -= gravity * dt;
      b.sprite.position.x += b.vx * dt;
      b.sprite.position.y += b.vy * dt;
      b.sprite.position.z += b.vz * dt;
      // Twinkle: a fast flicker riding a smooth fade-out, so each bit glints.
      const flicker = 0.55 + 0.45 * Math.sin(b.phase + b.age * b.twinkle);
      b.sprite.material.opacity = (1 - t * t) * flicker;
      // Shrink slightly as they die.
      b.sprite.scale.setScalar(b.s0 * (1 - 0.35 * t));
    }
  }
}
