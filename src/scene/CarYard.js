import * as THREE from 'three';
import settings from '../config/settings.js';
import { CarView } from './CarView.js';
import { showCashPopup } from './popup.js';

/**
 * CarYard — render-side owner of the whole car flow: the waiting queue, the pit,
 * and the floor highlight. It reconciles the core state (carQueue ids + pit.car)
 * into smooth tweens each frame and owns no game logic.
 *
 * Four animated moments:
 *   - spawn-in:     a new queued id appears -> create at the entrance, drive to its slot
 *   - queue advance: a queued car's slot index changes -> drive to the new slot
 *   - enter pit:    pit.car becomes a (previously queued) id -> drive that view into the pit
 *   - drive-off:    the pit car is fixed (id leaves) -> fully heal + drive out the exit + "+$"
 */
export class CarYard {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.pitPos = { x: settings.pit.x, z: settings.pit.z };

    this.queueViews = new Map(); // id -> CarView (cars in the lane)
    this.pitView = null;
    this.pitId = null;
    this.outgoing = []; // fixed cars driving away

    this.highlightT = 0;
    this.#buildHighlight();
  }

  #buildHighlight() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(settings.pit.radius * 0.82, settings.pit.radius, 48),
      new THREE.MeshBasicMaterial({
        color: settings.colors.pitGlow,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.pitPos.x, 0.05, this.pitPos.z);
    this.sm.add(ring);
    this.ring = ring;
  }

  /** Called by the input layer on a valid repair tap. */
  onTap() {
    this.pitView?.shake();
  }

  update(dt, state) {
    this.#syncPit(state);
    this.#syncQueue(state);

    if (this.pitView) this.pitView.update(dt);
    for (const v of this.queueViews.values()) v.update(dt);
    for (const v of this.outgoing) v.update(dt);

    this.#updateHighlight(dt, state);
  }

  #syncPit(state) {
    const pitCar = state.pit.car;
    const newId = pitCar ? pitCar.id : null;

    if (newId === this.pitId) {
      if (pitCar) this.pitView.setProgress(pitCar.repairWork / pitCar.totalWork);
      return;
    }

    // The pit car changed. First, send off the previous one (it was fixed).
    if (this.pitView) {
      const out = this.pitView;
      out.fixAll();
      out.driveTo(
        { x: this.pitPos.x, z: this.pitPos.z },
        { x: settings.exit.x, z: settings.exit.z },
        settings.pit.driveDuration,
        () => {
          out.dispose(this.sm);
          this.outgoing = this.outgoing.filter((v) => v !== out);
        }
      );
      this.outgoing.push(out);
      this.#popup(out.car.payout);
      this.pitView = null;
    }

    // Then bring in the new car: reuse its queued view if we have one (drive from
    // its current slot), otherwise create a fresh one at the entrance.
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
      view.driveTo(from, { x: this.pitPos.x, z: this.pitPos.z }, settings.pit.driveDuration);
      this.pitView = view;
    }

    this.pitId = newId;
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
      if (!ids.has(id) && id !== this.pitId) {
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

  #updateHighlight(dt, state) {
    this.highlightT += dt;
    const canRepair = state.pit.playerPresent && !!state.pit.car;
    const target = canRepair ? 0.45 + 0.22 * Math.sin(this.highlightT * 5) : 0;
    this.ring.material.opacity += (target - this.ring.material.opacity) * Math.min(1, 8 * dt);
  }

  #popup(amount) {
    const v = new THREE.Vector3(this.pitPos.x, 1.6, this.pitPos.z).project(this.sm.camera);
    const rect = this.sm.renderer.domElement.getBoundingClientRect();
    const x = (v.x * 0.5 + 0.5) * rect.width + rect.left;
    const y = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
    showCashPopup(`+$${amount}`, x, y);
  }
}
