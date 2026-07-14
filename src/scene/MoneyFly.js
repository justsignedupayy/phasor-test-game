import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import settings from '../config/settings.js';
import { assetUrl } from '../platform/assetUrl.js';

let moneyModelPromise = null;
export let moneyModel = null; // THREE.Object3D base scene to clone; live-binding, set once loaded

export function preloadMoneyModel() {
  if (!moneyModelPromise) {
    moneyModelPromise = new GLTFLoader().loadAsync(assetUrl('models/Money.glb')).then((gltf) => {
      moneyModel = gltf.scene;
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
