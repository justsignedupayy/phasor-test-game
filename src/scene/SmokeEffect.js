import * as THREE from 'three';

const POOL_SIZE = 42;
const SPAWN_MIN = 0.03; // seconds between emitted particles
const SPAWN_MAX = 0.06;
const LIFE_MIN = 1.2;
const LIFE_MAX = 1.9;
const START_OPACITY = 0.9;
const GROW = 3.0; // scale multiplier over a particle's life
const BASE_SCALE_MIN = 0.32;
const BASE_SCALE_MAX = 0.5;

let sharedTexture = null;

function getSmokeTexture() {
  if (sharedTexture) return sharedTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, 'rgba(180,180,180,1)');
  gradient.addColorStop(0.5, 'rgba(150,150,150,0.6)');
  gradient.addColorStop(1, 'rgba(120,120,120,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  sharedTexture = new THREE.CanvasTexture(canvas);
  return sharedTexture;
}

export class SmokeEffect {
  constructor() {
    this.group = new THREE.Group();
    const texture = getSmokeTexture();

    this.sprites = [];
    this.particles = []; // parallel to sprites: per-particle state
    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: 0x444444,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.group.add(sprite);
      this.sprites.push(sprite);
      this.particles.push({
        active: false,
        age: 0,
        life: 0,
        velocity: new THREE.Vector3(),
        baseScale: 0,
      });
    }

    this.spawnTimer = 0;
    this.wasActive = false;
  }

  #clear() {
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].active = false;
      this.sprites[i].visible = false;
      this.sprites[i].material.opacity = 0;
    }
  }

  #spawn() {
    const i = this.particles.findIndex((p) => !p.active);
    if (i === -1) return; // all in use — skip this emission
    const p = this.particles[i];
    const sprite = this.sprites[i];

    p.active = true;
    p.age = 0;
    p.life = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    p.baseScale = BASE_SCALE_MIN + Math.random() * (BASE_SCALE_MAX - BASE_SCALE_MIN);
    p.velocity.set(
      (Math.random() - 0.5) * 0.3, // slight horizontal drift
      0.5 + Math.random() * 0.4, // upward
      (Math.random() - 0.5) * 0.3
    );

    sprite.position.set((Math.random() - 0.5) * 0.15, 0, (Math.random() - 0.5) * 0.15);
    sprite.scale.setScalar(p.baseScale);
    sprite.material.opacity = START_OPACITY;
    sprite.visible = true;
  }

  update(dt, active) {
    if (!active && this.wasActive) this.#clear();
    this.wasActive = active;

    if (active) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.#spawn();
        this.spawnTimer = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      }
    }

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      const sprite = this.sprites[i];

      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.active = false;
        sprite.visible = false;
        sprite.material.opacity = 0;
        continue;
      }

      sprite.position.addScaledVector(p.velocity, dt);
      sprite.scale.setScalar(p.baseScale * (1 + (GROW - 1) * t));
      sprite.material.opacity = START_OPACITY * (1 - t);
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const sprite of this.sprites) sprite.material.dispose();
  }
}
