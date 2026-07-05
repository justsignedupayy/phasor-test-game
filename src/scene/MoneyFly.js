import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import settings from '../config/settings.js';

/**
 * MoneyFly — the shared "bills fly from A to B" animation used both when a
 * pit/pump's waiting pay is collected (scene/PitMoney.js, bills fly TO the
 * player) and when a physical unlock marker is auto-bought (scene/
 * UnlockMarkers.js, bills fly FROM the player). Owns the single Money.glb
 * load point; everyone else imports moneyModel/preloadMoneyModel from here.
 */
let moneyModelPromise = null;
export let moneyModel = null; // THREE.Object3D base scene to clone; live-binding, set once loaded

/** Loads Money.glb exactly once. Call (and await) before spawning any bills. */
export function preloadMoneyModel() {
  if (!moneyModelPromise) {
    moneyModelPromise = new GLTFLoader().loadAsync('/models/Money.glb').then((gltf) => {
      moneyModel = gltf.scene;
      // Green tint (settings.money.cashTintColor): multiply every material's base
      // colour so the glb's shading detail survives — same approach as the gas
      // pump prop's pumpTintColor. Tinting the base once covers every bill clone
      // (clone() shares these materials).
      const tint = new THREE.Color(settings.money.cashTintColor);
      moneyModel.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m.color) m.color.multiply(tint);
        }
      });
    });
  }
  return moneyModelPromise;
}

/**
 * Spawns `count` bill clones and flies them from fromPositions to toPosition.
 * fromPositions is either one {x,y,z} shared by every bill (each gets a small
 * random horizontal jitter so they don't perfectly overlap) or an array of
 * one {x,y,z} per bill (e.g. PitMoney's already-stacked bill positions — no
 * jitter added, they keep their exact spot).
 *
 * Returns a controller: call update(dt) every frame; `controller.done` flips
 * true once every bill has landed (each already removed from the scene the
 * moment it arrives — nothing left to clean up once done).
 */
export function spawnFlyingBills(
  sceneManager,
  count,
  fromPositions,
  toPosition,
  { duration = settings.money.flyDuration, stagger = 0.05, onBillArrive } = {}
) {
  const fromArray = Array.isArray(fromPositions);
  const bills = [];
  for (let i = 0; i < count; i++) {
    const base = fromArray ? fromPositions[i] : fromPositions;
    const jitterX = fromArray ? 0 : (Math.random() - 0.5) * 0.3;
    const jitterZ = fromArray ? 0 : (Math.random() - 0.5) * 0.3;
    const from = { x: base.x + jitterX, y: base.y ?? 0, z: base.z + jitterZ };

    const mesh = moneyModel.clone();
    mesh.scale.setScalar(settings.money.billScale);
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    mesh.position.set(from.x, from.y, from.z);
    sceneManager.add(mesh);

    bills.push({ mesh, from, t: 0, delay: i * stagger, arrived: false });
  }

  const controller = {
    done: count === 0,
    update(dt) {
      if (controller.done) return;
      let allArrived = true;
      bills.forEach((b, i) => {
        if (b.arrived) return;
        if (b.delay > 0) {
          b.delay -= dt;
          allArrived = false;
          return;
        }
        b.t = Math.min(1, b.t + dt / duration);
        b.mesh.position.x = b.from.x + (toPosition.x - b.from.x) * b.t;
        b.mesh.position.z = b.from.z + (toPosition.z - b.from.z) * b.t;
        if (b.t >= 1) {
          b.arrived = true;
          sceneManager.remove(b.mesh);
          onBillArrive?.(i);
        } else {
          allArrived = false;
        }
      });
      if (allArrived) controller.done = true;
    },
  };
  return controller;
}
