import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import settings from '../config/settings.js';
import { groundModel } from './characterAnim.js';

/**
 * CarView — wraps a clone of the shared cartoon_low_poly_car.glb model (see
 * preloadCarModel() below). The model has no skeleton, so a plain
 * scene.clone() per car is correct (no SkeletonUtils needed). It has no
 * separate damage-part meshes either, so it just drives in broken and out
 * fixed, with the tap shake/scale pop still working; per-part heal visuals
 * are gone since there's nothing on the model to heal independently.
 *
 * A car.tier === 'better' (reputation-attracted, higher payout) tints its
 * cloned materials blue, plus a brief spawn pulse so it stands out in queue.
 *
 * Render-only: driven by setProgress() / shake() / driveTo(), advanced by
 * update(dt). It holds a reference to its core car for `damageParts` + `payout`.
 */
const FIX_LERP = 6;
const SHAKE_TIME = 0.22;
const PULSE_TIME = 0.5;

let carModelPromise = null;
let carModelGltf = null;

/** Loads cartoon_low_poly_car.glb exactly once; call (and await) before creating any CarView. */
export function preloadCarModel() {
  if (!carModelPromise) {
    carModelPromise = new GLTFLoader().loadAsync('/models/cartoon_low_poly_car.glb').then((gltf) => {
      carModelGltf = gltf;
      return gltf;
    });
  }
  return carModelPromise;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class CarView {
  constructor(car) {
    this.car = car;
    this.root = new THREE.Group();
    this.bodyGroup = new THREE.Group(); // shaken/popped as one unit
    this.root.add(this.bodyGroup);

    this.fix = {}; // partName -> current heal 0..1 (kept for setProgress/fixAll compatibility)
    this.fixTarget = {}; // partName -> 0..1
    this.shakeT = 0;
    this.pulseT = car.tier === 'better' ? PULSE_TIME : 0; // brief spawn highlight
    this.drive = null; // { t, dur, from, to, onDone }
    this.targetSlot = -1; // used by CarYard to avoid re-tweening to the same slot

    this.#build();
  }

  #build() {
    if (!carModelGltf) {
      throw new Error('CarView: car model not preloaded — call preloadCarModel() before creating any CarView');
    }

    const cfg = settings.car;
    const model = carModelGltf.scene.clone();

    // The source scene also exports a large ground-plane mesh alongside the
    // car itself ("Floor_..."); strip it so it doesn't blow out the model's
    // bounding box (used below for grounding) or get raycast/tinted as part
    // of the car.
    const floorNodes = [];
    model.traverse((o) => {
      if (o.name.startsWith('Floor')) floorNodes.push(o);
    });
    for (const o of floorNodes) o.parent.remove(o);

    model.scale.setScalar(cfg.modelScale);
    model.rotation.y = cfg.modelYRotationOffset;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    if (this.car.tier === 'better') {
      tintBlue(model, cfg.betterTintColor);
    }

    this.bodyGroup.add(model);
    groundModel(model); // the model's mesh origin isn't at floor level — sit it on y=0

    // No damage-part meshes on this model — register a no-op target per part
    // so setProgress()/fixAll() (driven by core repair progress) stay valid.
    for (const name of this.car.damageParts) {
      this.fix[name] = 0;
      this.fixTarget[name] = 0;
    }
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
    // Heal lerps (no visual effect now, but kept so progress tracking stays correct).
    const k = Math.min(1, FIX_LERP * dt);
    for (const name in this.fix) {
      this.fix[name] += (this.fixTarget[name] - this.fix[name]) * k;
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

// Clones (so instances don't share/mutate color state) and multiplies a
// cloned model's mesh material colors toward `color` (used for "better" cars).
function tintBlue(model, color) {
  const tint = new THREE.Color(color);
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const wasArray = Array.isArray(o.material);
    const materials = wasArray ? o.material : [o.material];
    const tinted = materials.map((m) => {
      const t = m.clone();
      if (t.color) t.color.multiply(tint);
      return t;
    });
    o.material = wasArray ? tinted : tinted[0];
  });
}
