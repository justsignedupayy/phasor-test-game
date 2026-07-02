import * as THREE from 'three';
import settings from '../config/settings.js';
import { CarView } from './CarView.js';
import { Mechanic } from './Mechanic.js';
import { makeLabelSprite, disposeStorageMesh } from './PitView.js';
import { cloneStorageModel } from './StorageModels.js';
import { showCashPopup } from './popup.js';
import { requiredFillTicks } from '../core/gasStation.js';
import { formatMoney } from '../core/format.js';

/**
 * GasStationView — the whole render layer of the gas station in the world's
 * left quadrant, mirroring the garage's split responsibilities in one place:
 *
 *   environment  per-pump striped road (the same road + lane-dash system the
 *                garage roads use: settings.world.road tunables, road/laneStripe
 *                colors) and a pump-spot rectangle — shown once that pump's lot
 *                is opened (roomUnlocked), like Garage.js's per-pit sections.
 *   furniture    the gas_pump.glb prop (appear-animated like a pit's station),
 *                the tap-affordance highlight ring, the pump number label, and
 *                the attendant's break seat (chair, couch once upgraded) —
 *                PitView's job, minus the pit-only storage props.
 *   car flow     each pump's waiting queue, the car at the pump, and fixed cars
 *                driving off — CarYard's reconcile-into-tweens logic 1:1
 *                (spawn-in, queue advance, enter pump, drive-off + "+$").
 *   attendant    each pump's worker NPC — the Mechanic clone with its own tint,
 *                driven from core's pump.attendant exactly like a pit mechanic.
 *
 * Render-only: reads core state (state.gasStation), never mutates it.
 */
export class GasStationView {
  constructor(sceneManager, gltf) {
    this.sm = sceneManager;
    this.gltf = gltf;

    this.pumpViews = []; // per-pump static furniture (env + prop + ring + label + attendant)
    this.pumpCars = []; // CarView currently at each pump (or null)
    this.pumpIds = []; // core car id currently at each pump (or null)
    for (let i = 0; i < settings.maxPumps; i++) {
      this.pumpViews.push(this.#buildPump(i));
      this.pumpCars.push(null);
      this.pumpIds.push(null);
    }

    this.queueViews = new Map(); // id -> CarView (cars waiting in any pump's queue)
    this.outgoing = []; // filled cars driving away
    this._ndc = new THREE.Vector3(); // scratch for off-screen projection
  }

  /**
   * One pump's static pieces. The road is a single continuous slab (there is no
   * building out here to interrupt it) running the same total span as a pit's
   * entry+exit roads, with the dashed centre line skipped over the pump spot —
   * exactly how Garage.js keeps dashes off the pit spots.
   */
  #buildPump(index) {
    const c = settings.colors;
    const W = settings.world;
    const R = W.road;
    const G = settings.gasStation;
    const pos = G.positions[index];

    const env = new THREE.Group();

    // Road slab: one lane wide (pump spacing), spanning the full travelled z.
    const positions = G.positions;
    const laneWidth = positions.length > 1 ? Math.abs(positions[1].x - positions[0].x) : 4.5;
    const z0 = -(W.halfZ + R.extent);
    const z1 = W.halfZ + R.extent;
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(laneWidth, z1 - z0),
      new THREE.MeshStandardMaterial({ color: c.road })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(pos.x, 0.006, (z0 + z1) / 2);
    road.receiveShadow = true;
    env.add(road);

    // Dashed centre line: same dashLength/dashGap tunables as the garage roads,
    // never painted over the pump spot (mirrors Garage.js's overPit guard).
    const stripeMat = new THREE.MeshBasicMaterial({ color: c.laneStripe });
    const dashLen = R.dashLength;
    const step = dashLen + R.dashGap;
    const overPump = (z) => Math.abs(z - pos.z) < G.spotDepth / 2 + dashLen / 2;
    for (let z = z0 + step / 2; z + dashLen / 2 <= z1; z += step) {
      if (overPump(z)) continue;
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.15, dashLen), stripeMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(pos.x, 0.014, z);
      env.add(dash);
    }

    // Pump-spot rectangle (the gas mirror of the blue pit spot).
    const spot = new THREE.Mesh(
      new THREE.PlaneGeometry(G.spotWidth, G.spotDepth),
      new THREE.MeshBasicMaterial({ color: c.pitSpot })
    );
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(pos.x, 0.015, pos.z);
    env.add(spot);

    env.visible = false;
    this.sm.add(env);

    // The pump prop itself (equipped only, appear-animated like a pit station).
    // pumpModelScale / pumpModelYOffset / pumpYRotation are the tune-by-eye
    // fixups in settings.gasStation.
    const prop = cloneStorageModel('gasPump');
    prop.scale.setScalar(G.pumpModelScale);
    prop.position.set(pos.x + G.pumpOffset.x, G.pumpModelYOffset, pos.z + G.pumpOffset.z);
    prop.rotation.y = G.pumpYRotation;
    prop.visible = false;
    this.sm.add(prop);

    // Highlight ring (player-can-tap affordance), same shape as a pit's.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(G.radius * 0.78, G.radius, 40),
      new THREE.MeshBasicMaterial({
        color: c.pitGlow,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.05, pos.z);
    this.sm.add(ring);

    // Pump number label ("1", "2", …) — numbered, not lettered like pits.
    const label = makeLabelSprite(String(index + 1));
    label.position.set(pos.x, 3.0, pos.z);
    label.visible = false;
    this.sm.add(label);

    return {
      index,
      pos,
      env,
      prop,
      ring,
      label,
      attendant: null,
      propScale: 0,
      highlightT: 0,
      // Break seat beside the pump (appears once an attendant is hired, swapped
      // for a couch when its break room is upgraded) — PitView's seat, mirrored.
      chairPos: { ...settings.breaks.pumpChairPositions[index] },
      seat: null,
      _seatModelKey: null,
    };
  }

  /**
   * Build (or swap) a pump's break seat: a Chair by default, a couch once the
   * break room is upgraded — PitView#ensureSeat, mirrored per pump view.
   */
  #ensureSeat(view, upgraded) {
    const key = upgraded ? 'couch' : 'chair';
    if (view._seatModelKey === key) return;
    if (view.seat) disposeStorageMesh(this.sm, view.seat);
    const B = settings.breaks;
    const seat = cloneStorageModel(key);
    seat.scale.setScalar(upgraded ? B.couchScale : B.chairScale);
    seat.position.set(view.chairPos.x, 0, view.chairPos.z);
    seat.rotation.y = B.chairFacing;
    this.sm.add(seat);
    view.seat = seat;
    view._seatModelKey = key;
  }

  /** Tap feedback for a specific pump's car. */
  onTap(pumpIndex) {
    this.pumpCars[pumpIndex]?.shake();
  }

  /**
   * Raycast the pump break chairs; returns the pump index whose SEATED attendant's
   * chair was hit (so main.js can open the break panel), or -1 — CarYard's
   * raycastChair, mirrored. An empty chair isn't tappable.
   */
  raycastChair(raycaster, state) {
    for (let i = 0; i < this.pumpViews.length; i++) {
      const view = this.pumpViews[i];
      if (!view.seat || !state.gasStation.pumps[i].break.onBreak) continue;
      if (raycaster.intersectObject(view.seat, true).length > 0) return i;
    }
    return -1;
  }

  /** Raycast the pump cars; returns the pump index of the car under the ray, or -1. */
  raycast(raycaster) {
    const roots = this.pumpCars.filter(Boolean).map((v) => v.root);
    const hits = raycaster.intersectObjects(roots, true);
    if (hits.length === 0) return -1;
    let o = hits[0].object;
    while (o) {
      if (o.userData.pumpIndex !== undefined) return o.userData.pumpIndex;
      o = o.parent;
    }
    return -1;
  }

  update(dt, state) {
    const pumps = state.gasStation.pumps;
    pumps.forEach((pump, i) => this.#syncPumpCar(state, pump, i));
    this.#syncQueues(state);

    for (const v of this.pumpCars) if (v) v.update(dt);
    for (const v of this.queueViews.values()) v.update(dt);

    // Outgoing (filled) cars keep driving out; dispose each once off-screen.
    for (let j = this.outgoing.length - 1; j >= 0; j--) {
      const v = this.outgoing[j];
      v.update(dt);
      if (this.#offScreen(v)) {
        v.dispose(this.sm);
        this.outgoing.splice(j, 1);
      }
    }

    pumps.forEach((pump, i) => this.#updatePumpView(dt, pump, this.pumpViews[i]));
  }

  #updatePumpView(dt, pump, view) {
    view.env.visible = pump.roomUnlocked;
    view.label.visible = pump.roomUnlocked;
    view.prop.visible = pump.equipped;

    // Appear pop for the pump prop, mirroring PitView's station animation.
    const target = pump.equipped ? 1 : 0;
    const k = Math.min(1, 9 * dt);
    view.propScale += (target - view.propScale) * k;
    if (view.prop.visible) {
      const overshoot = 1 + 0.15 * Math.sin(Math.min(1, view.propScale) * Math.PI);
      view.prop.scale.setScalar(Math.max(0.001, view.propScale * overshoot) * settings.gasStation.pumpModelScale);
    }

    // Spawn this pump's attendant (and its break chair) the moment one is hired;
    // mirror core each frame — PitView's worker/seat handling 1:1.
    if (pump.hasAttendant && !view.attendant) {
      // 'gaspump' = the attendant's fill clip (gasput.glb), instead of 'repair'.
      view.attendant = new Mechanic(this.gltf, settings.character.attendantTint, 'gaspump');
      this.sm.add(view.attendant.root);
    }
    if (pump.hasAttendant) this.#ensureSeat(view, pump.break.breakDurationUpgraded);
    if (view.attendant && pump.attendant) {
      const B = settings.breaks;
      view.attendant.update(dt, {
        mechanic: pump.attendant,
        carPresent: !!pump.car && pump.car.settleRemaining <= 0,
        hurrying: pump.hurryTimer > 0,
        onBreak: pump.break.onBreak,
        chairFacing: B.chairFacing,
        seatOffset: pump.break.breakDurationUpgraded ? B.sitOffset.couch : B.sitOffset.chair,
      });
    }

    // Highlight only when the player can usefully tap here — same rule as pits.
    view.highlightT += dt;
    const canTap = pump.equipped && !!pump.car && pump.playerPresent && !pump.hasAttendant;
    const opTarget = canTap ? 0.45 + 0.22 * Math.sin(view.highlightT * 5) : 0;
    view.ring.material.opacity += (opTarget - view.ring.material.opacity) * Math.min(1, 8 * dt);
  }

  /** True once a car's position projects outside the camera frame (with margin). */
  #offScreen(view) {
    const p = view.root.position;
    this._ndc.set(p.x, 0.5, p.z).project(this.sm.camera);
    return Math.abs(this._ndc.x) > 1.15 || Math.abs(this._ndc.y) > 1.15;
  }

  #syncPumpCar(state, pump, i) {
    const pumpCar = pump.car;
    const newId = pumpCar ? pumpCar.id : null;

    if (newId === this.pumpIds[i]) {
      if (pumpCar) this.pumpCars[i].setProgress(pumpCar.ticksDone / requiredFillTicks(pumpCar));
      return;
    }

    const G = settings.gasStation;
    const pos = G.positions[i];
    const door = { x: pos.x, z: G.doorZ };

    // The pump car changed. Send off the previous one (it was filled): it keeps
    // driving forward (−z) past the exit and away, disposed once off-screen.
    if (this.pumpCars[i]) {
      const out = this.pumpCars[i];
      out.fixAll();
      const exit = { x: pos.x, z: G.exitDoorZ - 45 };
      out.driveTo({ x: pos.x, z: pos.z }, exit, G.driveDuration * 3);
      this.outgoing.push(out);
      // Pop "+$" here only when the cashier banks the pay instantly; otherwise
      // the money waits at the pump and PitMoney pops it on collection.
      if (state.hasCashier) this.#popup(out.car.payout, pos);
      this.pumpCars[i] = null;
    }

    // Bring in the new car: reuse its queued view or create one at the door.
    if (pumpCar) {
      let view = this.queueViews.get(pumpCar.id);
      let from;
      if (view) {
        this.queueViews.delete(pumpCar.id);
        from = view.position;
      } else {
        view = new CarView(pumpCar);
        this.sm.add(view.root);
        from = door;
      }
      view.root.userData.pumpIndex = i; // for tap raycasting
      view.driveTo(from, { x: pos.x, z: pos.z }, G.driveDuration);
      this.pumpCars[i] = view;
    }

    this.pumpIds[i] = newId;
  }

  #syncQueues(state) {
    const liveIds = new Set();
    const G = settings.gasStation;

    state.gasStation.pumps.forEach((pump, i) => {
      pump.queue.forEach((car, k) => {
        liveIds.add(car.id);
        const target = this.#slotPos(i, k);
        let view = this.queueViews.get(car.id);

        if (!view) {
          // Spawn-in: appear out beyond the last slot, drive up to this slot.
          view = new CarView(car);
          view.targetSlot = k;
          this.sm.add(view.root);
          this.queueViews.set(car.id, view);
          view.driveTo(this.#approachPos(i), target, G.driveDuration);
        } else if (view.targetSlot !== k) {
          // Queue advance: a car ahead left, step nearer the pump.
          view.targetSlot = k;
          view.driveTo(view.position, target, G.driveDuration);
        }
      });
    });

    // Safety: dispose any orphaned queue view (shouldn't normally happen).
    for (const [id, view] of this.queueViews) {
      if (!liveIds.has(id) && !this.pumpIds.includes(id)) {
        view.dispose(this.sm);
        this.queueViews.delete(id);
      }
    }
  }

  /** Waiting-slot position for pump i, queue index k: a line out toward +z. */
  #slotPos(i, k) {
    const G = settings.gasStation;
    return { x: G.positions[i].x, z: G.doorZ + k * G.queueSlotDepth };
  }

  /** Off-screen approach point a new car drives in from (beyond the last slot). */
  #approachPos(i) {
    const G = settings.gasStation;
    return { x: G.positions[i].x, z: G.doorZ + (G.spawn.maxQueuePerPump + 1) * G.queueSlotDepth };
  }

  #popup(amount, pos) {
    const v = new THREE.Vector3(pos.x, 1.6, pos.z).project(this.sm.camera);
    const rect = this.sm.renderer.domElement.getBoundingClientRect();
    const x = (v.x * 0.5 + 0.5) * rect.width + rect.left;
    const y = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
    showCashPopup(`+$${formatMoney(amount)}`, x, y);
  }
}
