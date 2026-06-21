import * as THREE from 'three';
import settings from '../config/settings.js';

/**
 * Mechanic — a low-poly NPC (distinct colour) that stands beside the pit and
 * plays a hammering repair motion whenever a car is present. While hurrying it
 * swings faster and throws sparks. Render-only; driven by update(dt, flags).
 */
const BASE_FREQ = 9;
const FAST_FREQ = 18;
const SPARK_LIFE = 0.4;
const MAX_SPARKS = 40;

export class Mechanic {
  /** @param {{x:number,z:number}} pitPos world position of the pit this worker serves */
  constructor(pitPos) {
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // bobs while working
    this.root.add(this.body);

    this.t = 0;
    this.workAmt = 0; // 0 idle .. 1 hammering
    this.sparkTimer = 0;
    this.sparks = [];

    // Stand beside the pit, facing the car.
    const px = pitPos.x + settings.mechanic.offsetX;
    const pz = pitPos.z + settings.mechanic.offsetZ;
    this.root.position.set(px, 0, pz);
    this.root.rotation.y = Math.atan2(pitPos.x - px, pitPos.z - pz);

    this.#build();
  }

  #build() {
    const c = settings.colors;
    const mat = (col) => new THREE.MeshStandardMaterial({ color: col, flatShading: true });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.95, 0.55), mat(c.mechBody));
    torso.position.y = 0.95;
    torso.castShadow = true;
    this.body.add(torso);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.5), mat(c.mechHead));
    head.position.y = 1.65;
    head.castShadow = true;
    this.body.add(head);

    // Static left arm + legs.
    const armL = this.#box(0.2, 0.65, 0.22, c.mechLimb);
    armL.position.set(-0.55, 1.0, 0);
    this.body.add(armL);
    for (const sx of [-0.2, 0.2]) {
      const leg = this.#box(0.26, 0.5, 0.28, c.mechLimb);
      leg.position.set(sx, 0.25, 0);
      this.body.add(leg);
    }

    // Right arm = hammer arm (pivots at the shoulder), with a wrench at the end.
    this.hammer = new THREE.Group();
    this.hammer.position.set(0.55, 1.25, 0.1);
    const upper = this.#box(0.2, 0.6, 0.22, c.mechLimb);
    upper.position.y = -0.3;
    this.hammer.add(upper);
    const tool = this.#box(0.16, 0.16, 0.5, c.wheel);
    tool.position.set(0, -0.6, 0.2);
    this.hammer.add(tool);
    this.body.add(this.hammer);

    // Spark resources (shared geo/mat; meshes are pooled into root).
    this.sparkGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: c.spark });
    // Contact point (front, near the car) in local space.
    this.contact = new THREE.Vector3(0.4, 1.0, -0.9);
  }

  #box(w, h, d, color) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, flatShading: true }));
    m.castShadow = true;
    return m;
  }

  update(dt, { carPresent, hurrying }) {
    // Ramp the hammering on/off with whether there's a car.
    this.workAmt += ((carPresent ? 1 : 0) - this.workAmt) * Math.min(1, 8 * dt);

    const freq = hurrying ? FAST_FREQ : BASE_FREQ;
    this.t += dt * freq * (0.25 + 0.75 * this.workAmt);

    // Hammer swing (0 = up, down toward the car) scaled by how active we are.
    const swing = 0.5 + 0.5 * Math.sin(this.t);
    this.hammer.rotation.x = -0.1 - 1.3 * swing * this.workAmt;
    this.body.position.y = Math.abs(Math.sin(this.t)) * 0.05 * this.workAmt;

    // Sparks while hurrying on a present car.
    if (hurrying && carPresent) {
      this.sparkTimer -= dt;
      while (this.sparkTimer <= 0) {
        this.#spawnSpark();
        this.sparkTimer += 0.035;
      }
    }
    this.#updateSparks(dt);
  }

  #spawnSpark() {
    if (this.sparks.length >= MAX_SPARKS) return;
    const mesh = new THREE.Mesh(this.sparkGeo, this.sparkMat);
    mesh.position.copy(this.contact);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
    this.root.add(mesh);
    this.sparks.push({ mesh, vel, life: SPARK_LIFE });
  }

  #updateSparks(dt) {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.vel.y -= 9 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.life -= dt;
      s.mesh.scale.setScalar(Math.max(0, s.life / SPARK_LIFE));
      if (s.life <= 0) {
        this.root.remove(s.mesh);
        this.sparks.splice(i, 1);
      }
    }
  }
}
