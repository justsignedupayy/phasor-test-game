import * as THREE from 'three';
import settings from '../config/settings.js';
import { CarView } from './CarView.js';
import { Mechanic } from './Mechanic.js';
import { makeLabelSprite } from './PitView.js';
import { cloneStorageModel } from './StorageModels.js';
import { makeAsphaltMaterial } from './groundTextures.js';
import { showCashPopup } from './popup.js';
import { requiredFillTicks } from '../core/gasStation.js';
import { formatMoney } from '../core/format.js';

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

  #buildPump(index) {
    const c = settings.colors;
    const W = settings.world;
    const R = W.road;
    const G = settings.gasStation;
    const pos = G.positions[index];

    const env = new THREE.Group();

    const positions = G.positions;
    const laneWidth = positions.length > 1 ? Math.abs(positions[1].x - positions[0].x) : 4.5;
    const z0 = -(W.halfZ + R.extent);
    const z1 = W.halfZ + R.extent;
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(laneWidth, z1 - z0),
      makeAsphaltMaterial(laneWidth, z1 - z0)
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(pos.x, 0.006, (z0 + z1) / 2);
    road.receiveShadow = true;
    env.add(road);

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

    env.visible = false;
    this.sm.add(env);

    const prop = cloneStorageModel('gasPump');
    const tint = new THREE.Color(G.pumpTintColor);
    prop.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.color) m.color.multiply(tint);
      }
    });
    prop.scale.setScalar(G.pumpModelScale);
    prop.position.set(pos.x + G.pumpOffset.x, G.pumpModelYOffset, pos.z + G.pumpOffset.z);
    prop.rotation.y = G.pumpYRotation;
    prop.visible = false;
    this.sm.add(prop);

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
    };
  }

  onTap(pumpIndex) {
    this.pumpCars[pumpIndex]?.shake();
  }

  raycastRestingWorker(raycaster, state) {
    for (let i = 0; i < this.pumpViews.length; i++) {
      const view = this.pumpViews[i];
      if (!view.attendant || !state.gasStation.pumps[i].break.onBreak) continue;
      if (raycaster.intersectObject(view.attendant.hitBox).length > 0) return i;
    }
    return -1;
  }

  raycastAttendant(raycaster) {
    for (let i = 0; i < this.pumpViews.length; i++) {
      const attendant = this.pumpViews[i].attendant;
      if (attendant && raycaster.intersectObject(attendant.hitBox).length > 0) return i;
    }
    return -1;
  }

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

    const target = pump.equipped ? 1 : 0;
    const k = Math.min(1, 9 * dt);
    view.propScale += (target - view.propScale) * k;
    if (view.prop.visible) {
      const overshoot = 1 + 0.15 * Math.sin(Math.min(1, view.propScale) * Math.PI);
      view.prop.scale.setScalar(Math.max(0.001, view.propScale * overshoot) * settings.gasStation.pumpModelScale);
    }

    if (pump.hasAttendant && !view.attendant) {
      view.attendant = new Mechanic(this.gltf, settings.character.attendantTint, 'gaspump');
      this.sm.add(view.attendant.root);
    }
    if (view.attendant && pump.attendant) {
      const B = settings.breaks;
      view.attendant.update(dt, {
        mechanic: pump.attendant,
        carPresent: !!pump.car && pump.car.settleRemaining <= 0,
        hurrying: pump.hurryTimer > 0,
        onBreak: pump.break.onBreak,
        breakState: pump.break, // the head label's "x/y" break-progress counter
        restFacing: B.breakSpotFacing,
        leanOffset: B.leanOffset,
      });
    }

    view.highlightT += dt;
    const canTap = pump.equipped && !!pump.car && pump.playerPresent && !pump.hasAttendant;
    const opTarget = canTap ? 0.45 + 0.22 * Math.sin(view.highlightT * 5) : 0;
    view.ring.material.opacity += (opTarget - view.ring.material.opacity) * Math.min(1, 8 * dt);
  }

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

    if (this.pumpCars[i]) {
      const out = this.pumpCars[i];
      out.fixAll();
      const exit = { x: pos.x, z: G.exitDoorZ - 45 };
      out.driveTo({ x: pos.x, z: pos.z }, exit, G.driveDuration * 3);
      this.outgoing.push(out);
      if (state.hasCashier) this.#popup(out.car.payout, pos);
      this.pumpCars[i] = null;
    }

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
          view = new CarView(car);
          view.targetSlot = k;
          this.sm.add(view.root);
          this.queueViews.set(car.id, view);
          view.driveTo(this.#approachPos(i), target, G.driveDuration);
        } else if (view.targetSlot !== k) {
          view.targetSlot = k;
          view.driveTo(view.position, target, G.driveDuration);
        }
      });
    });

    for (const [id, view] of this.queueViews) {
      if (!liveIds.has(id) && !this.pumpIds.includes(id)) {
        view.dispose(this.sm);
        this.queueViews.delete(id);
      }
    }
  }

  #slotPos(i, k) {
    const G = settings.gasStation;
    return { x: G.positions[i].x, z: G.doorZ + k * G.queueSlotDepth };
  }

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
