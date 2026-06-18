import * as THREE from 'three';
import settings from '../config/settings.js';

/**
 * Character — a low-poly figure built from primitives. Render-only: it reads the
 * core player state each frame and animates via transforms (idle/walk bob, limb
 * swing, smoothed turning). No skeletal rigging.
 *
 * Built facing +z so that rotation.y = atan2(dirX, dirZ) faces movement.
 */
const EMOTE_TIME = 0.5;

export class Character {
  constructor() {
    this.root = new THREE.Group(); // x/z position + facing
    this.body = new THREE.Group(); // bobs vertically; holds all parts
    this.root.add(this.body);
    this.bobTime = 0;
    this.emoteTimer = 0; // yell/hop emote countdown
    this.#build();
  }

  #build() {
    const c = settings.colors;
    const mat = (col) => new THREE.MeshStandardMaterial({ color: col, flatShading: true });

    // Feet rest at y = 0 (floor).
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.6), mat(c.body));
    torso.position.y = 1.0;
    torso.castShadow = true;
    this.body.add(torso);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 0.55), mat(c.head));
    head.position.y = 1.78;
    head.castShadow = true;
    this.body.add(head);

    // Facing indicator: a bright brim on the front (+z) of the head.
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.26), mat(c.accent));
    brim.position.set(0, 1.7, 0.34);
    brim.castShadow = true;
    this.body.add(brim);

    // Arms (pivot near the shoulder so they swing nicely).
    this.armL = this.#limb(0.22, 0.7, 0.25, c.limb);
    this.armL.position.set(-0.62, 1.35, 0);
    this.body.add(this.armL);

    this.armR = this.#limb(0.22, 0.7, 0.25, c.limb);
    this.armR.position.set(0.62, 1.35, 0);
    this.body.add(this.armR);

    // Legs.
    this.legL = this.#limb(0.28, 0.5, 0.3, c.limb);
    this.legL.position.set(-0.22, 0.5, 0);
    this.body.add(this.legL);

    this.legR = this.#limb(0.28, 0.5, 0.3, c.limb);
    this.legR.position.set(0.22, 0.5, 0);
    this.body.add(this.legR);

    // "!" yell marker above the head (a bar + a dot), hidden until yell().
    this.exclaim = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.14), mat(c.exclaim));
    bar.position.y = 0.3;
    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), mat(c.exclaim));
    dot.position.y = 0;
    this.exclaim.add(bar, dot);
    this.exclaim.position.y = 2.5;
    this.exclaim.visible = false;
    this.body.add(this.exclaim);
  }

  /** Quick yell emote (used by the remote hurry tap). */
  yell() {
    this.emoteTimer = EMOTE_TIME;
  }

  // A limb whose geometry hangs below a top pivot, so rotation.x swings it.
  #limb(w, h, d, color) {
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, flatShading: true })
    );
    mesh.position.y = -h / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  }

  update(dt, player) {
    // Position from core state.
    this.root.position.x = player.position.x;
    this.root.position.z = player.position.z;

    // Smoothly turn toward the target facing (frame-rate independent).
    const t = 1 - Math.exp(-settings.player.turnLerp * dt);
    this.root.rotation.y = lerpAngle(this.root.rotation.y, player.rotation, t);

    // Vertical bob: faster + bigger while walking.
    const b = settings.bob;
    const freq = player.moving ? b.walkFreq : b.idleFreq;
    const amp = player.moving ? b.walkAmp : b.idleAmp;
    this.bobTime += dt * freq;
    let y = Math.abs(Math.sin(this.bobTime)) * amp;

    // Yell emote: a single hop + scale pop, with the "!" marker showing.
    if (this.emoteTimer > 0) {
      this.emoteTimer = Math.max(0, this.emoteTimer - dt);
      const p = 1 - this.emoteTimer / EMOTE_TIME; // 0 -> 1
      const arc = Math.sin(p * Math.PI); // up then down
      y += arc * 0.5;
      this.body.scale.setScalar(1 + arc * 0.12);
      this.exclaim.visible = true;
      this.exclaim.scale.setScalar(0.4 + arc * 0.6);
    } else {
      this.body.scale.setScalar(1);
      this.exclaim.visible = false;
    }

    this.body.position.y = y;

    // Limb swing: pronounced while walking, a faint sway when idle.
    const swing = Math.sin(this.bobTime) * (player.moving ? b.armSwing : 0.04);
    this.armL.rotation.x = swing;
    this.armR.rotation.x = -swing;
    this.legL.rotation.x = -swing;
    this.legR.rotation.x = swing;
  }
}

// Shortest-path angle interpolation (handles wrap-around).
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
