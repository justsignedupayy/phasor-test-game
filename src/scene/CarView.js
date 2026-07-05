import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import settings from '../config/settings.js';
import { groundModel } from './characterAnim.js';
import { SmokeEffect } from './SmokeEffect.js';

/**
 * CarView — wraps a clone of the glb model for its car's reputation tier (one
 * model per tier; see settings.carTiers + preloadCarModels() below). The models
 * have no skeleton, so a plain scene.clone() per car is correct (no
 * SkeletonUtils needed). They have no separate damage-part meshes either, so a
 * car just drives in broken and out fixed, with the tap shake/scale pop still
 * working; per-part heal visuals are gone since there's nothing on the model to
 * heal independently.
 *
 * Tiers above the base one get a brief spawn pulse so the better-paying cars
 * stand out in queue (a scale animation, independent of which model is used).
 *
 * Render-only: driven by setProgress() / shake() / driveTo(), advanced by
 * update(dt). It holds a reference to its core car for `damageParts` + `payout`.
 */
const FIX_LERP = 6;
const SHAKE_TIME = 0.22;
const PULSE_TIME = 0.5;

let carModelsPromise = null;
const carModels = new Map(); // tier name -> THREE.Object3D base scene to clone

/**
 * Loads every tier's glb exactly once, in parallel, keying each resolved scene
 * by its tier name (settings.carTiers is the source of truth for the mapping).
 * Call (and await) before creating any CarView.
 */
export function preloadCarModels() {
  if (!carModelsPromise) {
    const loader = new GLTFLoader();
    carModelsPromise = Promise.all(
      settings.carTiers.map((tier) =>
        loader.loadAsync(`/models/${tier.model}`).then((gltf) => {
          carModels.set(tier.name, gltf.scene);
        })
      )
    );
  }
  return carModelsPromise;
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
    this.tierIndex = settings.carTiers.findIndex((t) => t.name === car.tier);
    this.pulseT = this.tierIndex > 0 ? PULSE_TIME : 0; // brief spawn highlight for above-base tiers
    this.drive = null; // { t, dur, from, to, onDone }
    this.targetSlot = -1; // used by CarYard to avoid re-tweening to the same slot

    this.#build();

    // Smoke plumes for damaged cars: engine bay + hood. Added to root (not
    // bodyGroup) so the tap shake/pulse scaling never distorts them; each
    // positioned by its own tunable offset.
    this.engineSmoke = new SmokeEffect();
    const e = settings.car.engineSmokeOffset;
    this.engineSmoke.group.position.set(e.x, e.y, e.z);
    this.root.add(this.engineSmoke.group);

    this.hoodSmoke = new SmokeEffect();
    const h = settings.car.hoodSmokeOffset;
    this.hoodSmoke.group.position.set(h.x, h.y, h.z);
    this.root.add(this.hoodSmoke.group);
  }

  #build() {
    const base = carModels.get(this.car.tier);
    if (!base) {
      throw new Error(
        `CarView: no preloaded model for tier "${this.car.tier}" — call preloadCarModels() before creating any CarView`
      );
    }

    const cfg = settings.car;
    const tier = settings.carTiers[this.tierIndex];
    const modelScale = tier?.modelScale ?? cfg.modelScale; // per-tier size fixup, falls back to the shared one
    const model = base.clone();

    // The source scenes also export a large ground-plane mesh alongside the
    // car itself ("Floor_..."); strip it so it doesn't blow out the model's
    // bounding box (used below for grounding) or get raycast as part of the car.
    const floorNodes = [];
    model.traverse((o) => {
      if (o.name.startsWith('Floor')) floorNodes.push(o);
    });
    for (const o of floorNodes) o.parent.remove(o);

    model.scale.setScalar(modelScale);
    model.rotation.y = cfg.modelYRotationOffset;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (!o.material) return;

      // Clone materials per instance: THREE's clone() shares material objects by
      // reference, and dispose() frees them — so without this, sending one fixed
      // car off would dispose the materials every other car still uses. We also
      // force the clones opaque: these glbs export every material with
      // baseColorFactor alpha 0 + alphaMode MASK, which three.js maps to
      // opacity 0 / alphaTest 0.5, discarding all colour fragments (the cars go
      // invisible while their depth-based shadows still render). No tint.
      const wasArray = Array.isArray(o.material);
      const fixed = (wasArray ? o.material : [o.material]).map((m) => {
        const c = m.clone();
        c.transparent = false;
        c.opacity = 1;
        c.alphaTest = 0;
        return c;
      });
      o.material = wasArray ? fixed : fixed[0];
    });

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
    const smoking = this.car.damageParts.length > 0 && !this.car.fixed;
    this.engineSmoke.update(dt, smoking);
    this.hoodSmoke.update(dt, smoking);

    // Heal lerps (no visual effect now, but kept so progress tracking stays correct).
    const k = Math.min(1, FIX_LERP * dt);
    for (const name in this.fix) {
      this.fix[name] += (this.fixTarget[name] - this.fix[name]) * k;
    }

    // Tap shake + scale pop, decaying over SHAKE_TIME; else a one-shot spawn
    // pulse for above-base-tier cars (no rotation, just a brief scale-up).
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
    this.engineSmoke.dispose();
    this.hoodSmoke.dispose();
    sceneManager.remove(this.root);
    // Dispose ONLY what this instance owns: its cloned materials (see #build).
    // The GEOMETRY is NOT ours to free — clone() shares it with the preloaded
    // base scene and every other live car of this tier, so disposing it here
    // yanks the GPU buffers out from under all of them: the same shared-resource
    // hazard the material cloning in #build guards against (cars keep casting
    // shadows and taking taps but render nothing). The base models live for the
    // whole session, so their geometry is never disposed per car.
    this.root.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}
