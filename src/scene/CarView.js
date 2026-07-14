import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import settings from '../config/settings.js';
import { assetUrl } from '../platform/assetUrl.js';
import { groundModel } from './characterAnim.js';
import { SmokeEffect } from './SmokeEffect.js';

const FIX_LERP = 6;
const SHAKE_TIME = 0.22;
const PULSE_TIME = 0.5;

let carModelsPromise = null;
const carModels = new Map(); // tier name -> THREE.Object3D base scene to clone

export function preloadCarModels() {
  if (!carModelsPromise) {
    const loader = new GLTFLoader();
    carModelsPromise = Promise.all(
      settings.carTiers.map((tier) =>
        loader.loadAsync(assetUrl(`models/${tier.model}`)).then((gltf) => {
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

    for (const name of this.car.damageParts) {
      this.fix[name] = 0;
      this.fixTarget[name] = 0;
    }
  }

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

    const k = Math.min(1, FIX_LERP * dt);
    for (const name in this.fix) {
      this.fix[name] += (this.fixTarget[name] - this.fix[name]) * k;
    }

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
    this.root.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}
