import * as THREE from 'three';
import settings from '../config/settings.js';
import { CarView } from './CarView.js';
import { PitView } from './PitView.js';
import { showCashPopup } from './popup.js';
import { requiredTicks } from '../core/upgrades.js';
import { formatMoney } from '../core/format.js';

/**
 * CarYard — render-side owner of the whole car flow across every pit: the shared
 * waiting queue plus, for each pit, the car currently being repaired and any
 * fixed cars driving away. It also owns the PitView furniture and reconciles core
 * state (carQueue ids + each pit.car) into smooth tweens each frame. No game logic.
 *
 * Animated moments (now per-pit):
 *   - spawn-in:      a new queued id appears -> create at the entrance, drive to its slot
 *   - queue advance: a queued car's slot index changes -> drive to the new slot
 *   - enter pit:     pit.car becomes a (previously queued) id -> drive that view into the pit
 *   - drive-off:     a pit car is fixed (id leaves) -> fully heal + drive out + "+$"
 */
export class CarYard {
  constructor(sceneManager, gltf) {
    this.sm = sceneManager;

    this.pitViews = []; // PitView per pit (static furniture + worker + ring)
    this.pitCars = []; // CarView currently in each pit (or null)
    this.pitIds = []; // core car id currently in each pit (or null)
    for (let i = 0; i < settings.maxPits; i++) {
      this.pitViews.push(new PitView(sceneManager, i, gltf));
      this.pitCars.push(null);
      this.pitIds.push(null);
    }

    this.queueViews = new Map(); // id -> CarView (cars waiting in the lane)
    this.outgoing = []; // fixed cars driving away
  }

  /** Tap feedback for a specific pit's car. */
  onTap(pitIndex) {
    this.pitCars[pitIndex]?.shake();
  }

  /**
   * Raycast the pit cars; returns the pit index of the car under the ray, or -1.
   * Used by the input layer so a tap targets whichever car was touched.
   */
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

  update(dt, state) {
    state.pits.forEach((pit, i) => this.#syncPitCar(state, pit, i));
    this.#syncQueue(state);

    for (const v of this.pitCars) if (v) v.update(dt);
    for (const v of this.queueViews.values()) v.update(dt);
    for (const v of this.outgoing) v.update(dt);

    state.pits.forEach((pit, i) => this.pitViews[i].update(dt, pit));
  }

  #syncPitCar(state, pit, i) {
    const pitCar = pit.car;
    const newId = pitCar ? pitCar.id : null;

    if (newId === this.pitIds[i]) {
      if (pitCar) this.pitCars[i].setProgress(pitCar.ticksDone / requiredTicks(pitCar, pit));
      return;
    }

    const pos = settings.pit.positions[i];

    // The pit car changed. First, send off the previous one (it was fixed).
    if (this.pitCars[i]) {
      const out = this.pitCars[i];
      out.fixAll();
      out.driveTo(
        { x: pos.x, z: pos.z },
        { x: settings.exit.x, z: settings.exit.z },
        settings.pit.driveDuration,
        () => {
          out.dispose(this.sm);
          this.outgoing = this.outgoing.filter((v) => v !== out);
        }
      );
      this.outgoing.push(out);
      this.#popup(out.car.payout, pos);
      this.pitCars[i] = null;
    }

    // Bring in the new car: reuse its queued view if present (drive from its slot),
    // otherwise create a fresh one at the entrance.
    if (pitCar) {
      let view = this.queueViews.get(pitCar.id);
      let from;
      if (view) {
        this.queueViews.delete(pitCar.id);
        from = view.position;
      } else {
        view = new CarView(pitCar);
        this.sm.add(view.root);
        from = { x: settings.entrance.x, z: settings.entrance.z };
      }
      view.root.userData.pitIndex = i; // for tap raycasting
      view.driveTo(from, { x: pos.x, z: pos.z }, settings.pit.driveDuration);
      this.pitCars[i] = view;
    }

    this.pitIds[i] = newId;
  }

  #syncQueue(state) {
    const queue = state.carQueue;
    const ids = new Set(queue.map((c) => c.id));

    queue.forEach((car, i) => {
      const target = this.#slotPos(i);
      let view = this.queueViews.get(car.id);

      if (!view) {
        // Spawn-in.
        view = new CarView(car);
        view.targetSlot = i;
        this.sm.add(view.root);
        this.queueViews.set(car.id, view);
        view.driveTo({ x: settings.entrance.x, z: settings.entrance.z }, target, settings.pit.driveDuration);
      } else if (view.targetSlot !== i) {
        // Queue advance.
        view.targetSlot = i;
        view.driveTo(view.position, target, settings.pit.driveDuration);
      }
    });

    // Safety: dispose any orphaned queue view (shouldn't normally happen).
    for (const [id, view] of this.queueViews) {
      if (!ids.has(id) && !this.pitIds.includes(id)) {
        view.dispose(this.sm);
        this.queueViews.delete(id);
      }
    }
  }

  #slotPos(i) {
    return {
      x: settings.queue.frontX + settings.queue.slotDX * i,
      z: settings.queue.frontZ + settings.queue.slotDZ * i,
    };
  }

  #popup(amount, pos) {
    const v = new THREE.Vector3(pos.x, 1.6, pos.z).project(this.sm.camera);
    const rect = this.sm.renderer.domElement.getBoundingClientRect();
    const x = (v.x * 0.5 + 0.5) * rect.width + rect.left;
    const y = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
    showCashPopup(`+$${formatMoney(amount)}`, x, y);
  }
}
