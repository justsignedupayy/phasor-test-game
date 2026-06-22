import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import settings from '../config/settings.js';
import { collectMoney } from '../core/simulation.js';

/**
 * MoneyStack — bills piling up on the computer desk as repaired cars pay out
 * (state.computerStackCount), flying to the player on collection. Render-only:
 * core owns computerCash/computerStackCount/maxStackCount; this just mirrors
 * the count in clones and calls collectMoney() once the player is close enough.
 */
let moneyModelPromise = null;
let moneyModel = null; // THREE.Object3D base scene to clone

/** Loads Money.glb exactly once. Call (and await) before creating a MoneyStack. */
export function preloadMoneyModel() {
  if (!moneyModelPromise) {
    moneyModelPromise = new GLTFLoader().loadAsync('/models/Money.glb').then((gltf) => {
      moneyModel = gltf.scene;
    });
  }
  return moneyModelPromise;
}

export class MoneyStack {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.bills = []; // cloned bill meshes, stacked on the desk

    const pos = settings.computer;
    // Offset off the desk's centre (away from the monitor stand at x=0,z=-0.15)
    // so the stack sits on open desk surface.
    this.base = { x: pos.x + 0.5, y: 0.72, z: pos.z + 0.2 };

    this.collecting = false;
    this.flyT = 0;
    this.flyFrom = [];
    this.flyTarget = { x: 0, z: 0 };
  }

  #spawnBill(i) {
    const bill = moneyModel.clone();
    bill.scale.setScalar(settings.money.billScale);
    bill.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    bill.position.set(this.base.x, this.base.y + i * settings.money.billSpacing, this.base.z);
    this.sm.add(bill);
    return bill;
  }

  update(dt, state, playerPos) {
    if (!moneyModel) return; // not loaded yet

    if (this.collecting) {
      this.#updateCollecting(dt, state);
      return;
    }

    while (this.bills.length < state.computerStackCount) {
      this.bills.push(this.#spawnBill(this.bills.length));
    }
    while (this.bills.length > state.computerStackCount) {
      disposeBill(this.sm, this.bills.pop());
    }

    const dx = playerPos.x - settings.computer.x;
    const dz = playerPos.z - settings.computer.z;
    const near = Math.hypot(dx, dz) <= settings.money.collectRadius;
    if (near && state.computerStackCount > 0) {
      this.collecting = true;
      this.flyT = 0;
      this.flyFrom = this.bills.map((b) => b.position.clone());
      this.flyTarget = { x: playerPos.x, z: playerPos.z };
    }
  }

  #updateCollecting(dt, state) {
    this.flyT = Math.min(1, this.flyT + dt / settings.money.flyDuration);
    this.bills.forEach((bill, i) => {
      const from = this.flyFrom[i];
      bill.position.x = from.x + (this.flyTarget.x - from.x) * this.flyT;
      bill.position.z = from.z + (this.flyTarget.z - from.z) * this.flyT;
    });

    if (this.flyT >= 1) {
      for (const bill of this.bills) disposeBill(this.sm, bill);
      this.bills = [];
      collectMoney(state);
      this.collecting = false;
    }
  }
}

function disposeBill(sceneManager, bill) {
  sceneManager.remove(bill);
  bill.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
}
