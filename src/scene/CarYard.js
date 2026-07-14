import * as THREE from 'three';
import settings from '../config/settings.js';
import { CarView } from './CarView.js';
import { PitView } from './PitView.js';
import { showCashPopup, worldToScreen } from './popup.js';
import { requiredTicks } from '../core/upgrades.js';
import { formatMoney } from '../core/format.js';

export class CarYard {
  constructor(sceneManager, gltf, effects = {}) {
    this.sm = sceneManager;
    this.poofs = effects.poofs ?? null;
    this.sparkles = effects.sparkles ?? null;

    this.pitViews = []; // PitView per pit (static furniture + worker + ring)
    this.pitCars = []; // CarView currently in each pit (or null)
    this.pitIds = []; // core car id currently in each pit (or null)
    for (let i = 0; i < settings.maxPits; i++) {
      this.pitViews.push(new PitView(sceneManager, i, gltf));
      this.pitCars.push(null);
      this.pitIds.push(null);
    }

    this.queueViews = new Map(); // id -> CarView (cars waiting in any pit's queue)
    this.outgoing = []; // fixed cars driving away
    this._ndc = new THREE.Vector3(); // scratch for off-screen projection
    this.celebrationWindows = []; // seconds left in each recent burst's overlap window (fill-rate cap)
  }

  onTap(pitIndex) {
    this.pitCars[pitIndex]?.shake();
  }

  raycast(raycaster) {
    const roots = this.pitCars.filter(Boolean).map((v) => v.root);
    const hits = raycaster.intersectObjects(roots, true);
    if (hits.length === 0) return -1;
    let o = hits[0].object;
    while (o) {
      if (o.userData.pitIndex !== undefined) return o.userData.pitIndex;
      o = o.parent;
    }
    return -1;
  }

  raycastRestingWorker(raycaster, state) {
    for (let i = 0; i < this.pitViews.length; i++) {
      const view = this.pitViews[i];
      if (!view.mechanic || !state.pits[i].break.onBreak) continue;
      if (raycaster.intersectObject(view.mechanic.hitBox).length > 0) return i;
    }
    return -1;
  }

  raycastMechanic(raycaster) {
    for (let i = 0; i < this.pitViews.length; i++) {
      const mechanic = this.pitViews[i].mechanic;
      if (mechanic && raycaster.intersectObject(mechanic.hitBox).length > 0) return i;
    }
    return -1;
  }

  update(dt, state) {
    let w = 0;
    for (const t of this.celebrationWindows) if (t - dt > 0) this.celebrationWindows[w++] = t - dt;
    this.celebrationWindows.length = w;

    state.pits.forEach((pit, i) => this.#syncPitCar(state, pit, i));
    this.#syncQueues(state);

    for (const v of this.pitCars) if (v) v.update(dt);
    for (const v of this.queueViews.values()) v.update(dt);

    for (let j = this.outgoing.length - 1; j >= 0; j--) {
      const v = this.outgoing[j];
      v.update(dt);
      if (this.#offScreen(v)) {
        v.dispose(this.sm);
        this.outgoing.splice(j, 1);
      }
    }

    state.pits.forEach((pit, i) => this.pitViews[i].update(dt, pit, state));
  }

  #offScreen(view) {
    const p = view.root.position;
    this._ndc.set(p.x, 0.5, p.z).project(this.sm.camera);
    return Math.abs(this._ndc.x) > 1.15 || Math.abs(this._ndc.y) > 1.15;
  }

  #syncPitCar(state, pit, i) {
    const pitCar = pit.car;
    const newId = pitCar ? pitCar.id : null;

    if (newId === this.pitIds[i]) {
      if (pitCar) this.pitCars[i].setProgress(pitCar.ticksDone / requiredTicks(pitCar, pit));
      return;
    }

    const pos = settings.pit.positions[i];
    const door = { x: pos.x, z: settings.pit.doorZ };

    if (this.pitCars[i]) {
      const out = this.pitCars[i];
      out.fixAll();
      const exit = { x: pos.x, z: settings.pit.exitDoorZ - 45 };
      out.driveTo({ x: pos.x, z: pos.z }, exit, settings.pit.driveDuration * 3);
      this.outgoing.push(out);
      if (state.hasCashier) this.#popup(out.car.payout, pos);
      this.#celebrate(pos);
      this.pitCars[i] = null;
    }

    if (pitCar) {
      let view = this.queueViews.get(pitCar.id);
      let from;
      if (view) {
        this.queueViews.delete(pitCar.id);
        from = view.position;
      } else {
        view = new CarView(pitCar);
        this.sm.add(view.root);
        from = door;
      }
      view.root.userData.pitIndex = i; // for tap raycasting
      view.driveTo(from, { x: pos.x, z: pos.z }, settings.pit.driveDuration);
      this.pitCars[i] = view;
    }

    this.pitIds[i] = newId;
  }

  #syncQueues(state) {
    const liveIds = new Set();

    state.pits.forEach((pit, i) => {
      pit.queue.forEach((car, k) => {
        liveIds.add(car.id);
        const target = this.#slotPos(i, k);
        let view = this.queueViews.get(car.id);

        if (!view) {
          view = new CarView(car);
          view.targetSlot = k;
          this.sm.add(view.root);
          this.queueViews.set(car.id, view);
          view.driveTo(this.#approachPos(i), target, settings.pit.driveDuration);
        } else if (view.targetSlot !== k) {
          view.targetSlot = k;
          view.driveTo(view.position, target, settings.pit.driveDuration);
        }
      });
    });

    for (const [id, view] of this.queueViews) {
      if (!liveIds.has(id) && !this.pitIds.includes(id)) {
        view.dispose(this.sm);
        this.queueViews.delete(id);
      }
    }
  }

  #slotPos(i, k) {
    return {
      x: settings.pit.positions[i].x,
      z: settings.pit.doorZ + k * settings.pit.queueSlotDepth,
    };
  }

  #approachPos(i) {
    return {
      x: settings.pit.positions[i].x,
      z: settings.pit.doorZ + (settings.spawn.maxQueuePerPit + 1) * settings.pit.queueSlotDepth,
    };
  }

  // Repair-complete poof+sparkle, fill-rate-capped for iOS: bursts stack large
  // soft-alpha quads on one spot every few seconds, so they're smaller than
  // reveal poofs and at most 2 overlap — extras skip the visual, never the pay.
  #celebrate(pos) {
    if (this.celebrationWindows.length >= 2) return;
    this.celebrationWindows.push(0.45); // ≈ a poof's lifetime, so "overlapping" means actually on screen together
    this.poofs?.spawn({ x: pos.x, y: 0.7, z: pos.z }, 0.85, 5);
    this.sparkles?.spawn({ x: pos.x, y: 0.95, z: pos.z }, 1.0, 8);
  }

  #popup(amount, pos) {
    const { x, y } = worldToScreen({ x: pos.x, y: 1.6, z: pos.z }, this.sm.camera, this.sm.renderer.domElement);
    showCashPopup(`+$${formatMoney(amount)}`, x, y);
  }
}
