import * as THREE from 'three';
import settings from '../config/settings.js';

/**
 * CarView — a low-poly car (primitives only) built from its car's actual
 * damageParts, so a 1-, 2-, or 3-damage car looks different. Each present part
 * heals independently; the car also has a tap shake/pop and drive tweens.
 *
 *   tire  -> a flat, tilted wheel that rights and inflates
 *   smoke -> grey cones that fade and shrink away
 *   dent  -> a sunken, tilted hood panel that pops flush
 *
 * Render-only: driven by setProgress() / shake() / driveTo(), advanced by
 * update(dt). It holds a reference to its core car for `damageParts` + `payout`.
 * A car.tier === 'better' (reputation-attracted, higher payout) reuses this same
 * build but in blue paint, plus a brief spawn pulse so it stands out in the queue.
 */
const FIX_LERP = 6;
const SHAKE_TIME = 0.22;
const PULSE_TIME = 0.5;

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class CarView {
  constructor(car) {
    this.car = car;
    this.root = new THREE.Group();
    this.bodyGroup = new THREE.Group(); // shaken/popped as one unit
    this.root.add(this.bodyGroup);

    this.fix = {}; // partName -> current heal 0..1
    this.fixTarget = {}; // partName -> 0..1
    this.applyFns = {}; // partName -> (v) => void
    this.shakeT = 0;
    this.pulseT = car.tier === 'better' ? PULSE_TIME : 0; // brief spawn highlight
    this.smokeT = 0;
    this.drive = null; // { t, dur, from, to, onDone }
    this.targetSlot = -1; // used by CarYard to avoid re-tweening to the same slot

    this.#build();
  }

  #build() {
    const c = settings.colors;
    const mat = (col, extra = {}) =>
      new THREE.MeshStandardMaterial({ color: col, flatShading: true, ...extra });

    const isBetter = this.car.tier === 'better';

    const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 1.6), mat(isBetter ? c.carBodyBetter : c.carBody));
    body.position.y = 0.7;
    body.castShadow = true;
    body.receiveShadow = true;
    this.bodyGroup.add(body);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.4), mat(isBetter ? c.carCabinBetter : c.carCabin));
    cabin.position.set(-0.2, 1.25, 0);
    cabin.castShadow = true;
    this.bodyGroup.add(cabin);

    const hasTire = this.car.damageParts.includes('tire');

    // Four wheels; index 0 is the damaged one if this car has tire damage.
    const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 16);
    const wheelMat = mat(c.wheel);
    const positions = [
      [1.1, 0.45, 0.8],
      [1.1, 0.45, -0.8],
      [-1.1, 0.45, 0.8],
      [-1.1, 0.45, -0.8],
    ];
    positions.forEach(([x, y, z], i) => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      if (i === 0 && hasTire) {
        const g = new THREE.Group();
        g.position.set(x, 0.3, z);
        g.add(wheel);
        this.bodyGroup.add(g);
        this.#registerTire(g);
      } else {
        wheel.position.set(x, y, z);
        this.bodyGroup.add(wheel);
      }
    });

    if (this.car.damageParts.includes('dent')) this.#registerDent(mat(c.carDent));
    if (this.car.damageParts.includes('smoke')) {
      this.#registerSmoke(mat(c.smoke, { transparent: true, opacity: 0.85 }));
    }
  }

  #registerPart(name, applyFn) {
    this.fix[name] = 0;
    this.fixTarget[name] = 0;
    this.applyFns[name] = applyFn;
    applyFn(0);
  }

  #registerTire(group) {
    this.#registerPart('tire', (v) => {
      group.scale.y = 0.55 + 0.45 * v;
      group.rotation.x = 0.35 * (1 - v);
      group.position.y = 0.3 + 0.15 * v;
    });
  }

  #registerDent(mat) {
    const baseY = 1.06;
    const dent = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 1.3), mat);
    dent.position.set(0.85, baseY, 0);
    dent.castShadow = true;
    this.bodyGroup.add(dent);
    this.#registerPart('dent', (v) => {
      dent.position.y = baseY - 0.16 * (1 - v);
      dent.rotation.z = 0.18 * (1 - v);
    });
  }

  #registerSmoke(mat) {
    this.smokeMat = mat;
    const meshes = [];
    [[0.35, 1.55], [0.3, 1.95], [0.24, 2.3]].forEach(([r, py]) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, r * 1.6, 8), mat);
      m.position.set(1.2, py, 0);
      this.bodyGroup.add(m);
      meshes.push(m);
    });
    this.#registerPart('smoke', (v) => {
      mat.opacity = 0.85 * (1 - v);
      const visible = v < 0.99;
      meshes.forEach((m, i) => {
        const wob = 1 + Math.sin(this.smokeT * 3 + i) * 0.05;
        m.scale.setScalar((1 - v) * wob);
        m.visible = visible;
      });
    });
  }

  /** Fix parts whose threshold has been passed: part i of n clears at (i+1)/n. */
  setProgress(progress) {
    const parts = this.car.damageParts;
    parts.forEach((name, i) => {
      const threshold = (i + 1) / parts.length;
      if (progress >= threshold - 1e-6 && this.fixTarget[name] !== undefined) {
        this.fixTarget[name] = 1;
      }
    });
  }

  fixAll() {
    for (const name in this.fixTarget) this.fixTarget[name] = 1;
  }

  shake() {
    this.shakeT = SHAKE_TIME;
  }

  driveTo(from, to, dur, onDone) {
    this.root.position.set(from.x, 0, from.z);
    this.drive = { t: 0, dur, from, to, onDone };
  }

  get position() {
    return { x: this.root.position.x, z: this.root.position.z };
  }

  update(dt) {
    this.smokeT += dt;

    // Heal lerps.
    const k = Math.min(1, FIX_LERP * dt);
    for (const name in this.fix) {
      this.fix[name] += (this.fixTarget[name] - this.fix[name]) * k;
      this.applyFns[name](this.fix[name]);
    }

    // Tap shake + scale pop, decaying over SHAKE_TIME; else a one-shot spawn
    // pulse for "better" cars (no rotation, just a brief scale-up).
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const f = this.shakeT / SHAKE_TIME;
      this.bodyGroup.rotation.z = Math.sin(this.shakeT * 70) * 0.1 * f;
      this.bodyGroup.scale.setScalar(1 + 0.06 * f);
    } else if (this.pulseT > 0) {
      this.pulseT = Math.max(0, this.pulseT - dt);
      const f = this.pulseT / PULSE_TIME;
      this.bodyGroup.rotation.z = 0;
      this.bodyGroup.scale.setScalar(1 + 0.16 * f);
    } else {
      this.bodyGroup.rotation.z = 0;
      this.bodyGroup.scale.setScalar(1);
    }

    // Drive tween.
    if (this.drive) {
      this.drive.t += dt / this.drive.dur;
      const t = Math.min(1, this.drive.t);
      const e = easeInOut(t);
      this.root.position.x = this.drive.from.x + (this.drive.to.x - this.drive.from.x) * e;
      this.root.position.z = this.drive.from.z + (this.drive.to.z - this.drive.from.z) * e;
      if (t >= 1) {
        const done = this.drive.onDone;
        this.drive = null;
        done?.();
      }
    }
  }

  dispose(sceneManager) {
    sceneManager.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}
