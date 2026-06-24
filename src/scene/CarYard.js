import * as THREE from 'three';
import settings from '../config/settings.js';
import { CarView } from './CarView.js';
import { PitView } from './PitView.js';
import { showCashPopup } from './popup.js';
import { requiredTicks } from '../core/upgrades.js';
import { formatMoney } from '../core/format.js';

/**
 * CarYard — render-side owner of the whole car flow across every pit. Each pit
 * has its own waiting queue lined up outside its back-wall door, the car
 * currently being repaired, and any fixed cars driving back out. It also owns
 * the PitView furniture and reconciles core state (each pit's queue ids + its
 * car) into smooth tweens each frame. No game logic.
 *
 * Per-pit animated moments:
 *   - spawn-in:      a new id appears in pit.queue -> create out beyond the door, drive to its slot
 *   - queue advance: a queued car's slot index drops -> drive to the new (nearer) slot
 *   - enter pit:     pit.car becomes a (previously queued) id -> drive it from the door into the pit
 *   - drive-off:     a pit car is fixed (id leaves) -> fully heal + drive out the FRONT door + "+$"
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

    this.queueViews = new Map(); // id -> CarView (cars waiting in any pit's queue)
    this.outgoing = []; // fixed cars driving away
    this._ndc = new THREE.Vector3(); // scratch for off-screen projection
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
    this.#syncQueues(state);

    for (const v of this.pitCars) if (v) v.update(dt);
    for (const v of this.queueViews.values()) v.update(dt);

    // Outgoing (fixed) cars keep driving out the front; dispose each once it has
    // actually left the screen (not at a fixed point — the camera follows).
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

  /** True once a car's position projects outside the camera frame (with margin). */
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

    // The pit car changed. First, send off the previous one (it was fixed): it
    // keeps driving forward (−z) out through the FRONT-wall door and away. The
    // target is well beyond the wall; update() disposes it the moment it is
    // actually off-screen, which is camera-follow-proof (a fixed z wouldn't be).
    if (this.pitCars[i]) {
      const out = this.pitCars[i];
      out.fixAll();
      const exit = { x: pos.x, z: settings.pit.exitDoorZ - 45 };
      out.driveTo({ x: pos.x, z: pos.z }, exit, settings.pit.driveDuration * 3);
      this.outgoing.push(out);
      // Pop "+$" here only when the cashier banks the pay instantly. Without a
      // cashier the money waits at the pit; PitMoney pops it on collection.
      if (state.hasCashier) this.#popup(out.car.payout, pos);
      this.pitCars[i] = null;
    }

    // Bring in the new car: reuse its queued view (now at the front slot ≈ the
    // door) and drive it straight back into the pit, or create one at the door.
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
          // Spawn-in: appear out beyond the last slot, drive up to this slot.
          view = new CarView(car);
          view.targetSlot = k;
          this.sm.add(view.root);
          this.queueViews.set(car.id, view);
          view.driveTo(this.#approachPos(i), target, settings.pit.driveDuration);
        } else if (view.targetSlot !== k) {
          // Queue advance: a car ahead left, step nearer the door.
          view.targetSlot = k;
          view.driveTo(view.position, target, settings.pit.driveDuration);
        }
      });
    });

    // Safety: dispose any orphaned queue view (shouldn't normally happen).
    for (const [id, view] of this.queueViews) {
      if (!liveIds.has(id) && !this.pitIds.includes(id)) {
        view.dispose(this.sm);
        this.queueViews.delete(id);
      }
    }
  }

  /** Waiting-slot position for pit i, queue index k: a line out behind the door (+z). */
  #slotPos(i, k) {
    return {
      x: settings.pit.positions[i].x,
      z: settings.pit.doorZ + k * settings.pit.queueSlotDepth,
    };
  }

  /** Off-screen approach point a new car drives in from (beyond the last slot). */
  #approachPos(i) {
    return {
      x: settings.pit.positions[i].x,
      z: settings.pit.doorZ + (settings.spawn.maxQueuePerPit + 1) * settings.pit.queueSlotDepth,
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
