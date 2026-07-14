import * as THREE from 'three';
import settings from '../config/settings.js';
import { cloneStorageModel } from './StorageModels.js';

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class TruckView {
  constructor(sceneManager) {
    this.sm = sceneManager;

    const T = settings.supermarket.truck;
    this.model = cloneStorageModel('truck');
    this.model.scale.setScalar(T.modelScale);
    this.model.visible = false;
    sceneManager.add(this.model);

    this.phase = 'idle';
    this.drive = null; // { t, dur, from, to }
    this.waitT = 0;
    this.onDelivered = null;

    const box = settings.supermarket.restockBoxPosition;
    this.deliverPos = { x: box.x + T.deliverOffset.x, z: box.z + T.deliverOffset.z };
    this.startPos = { x: box.x + T.startOffset.x, z: box.z + T.startOffset.z };
  }

  get idle() {
    return this.phase === 'idle';
  }

  arrive(onDelivered) {
    if (this.phase !== 'idle') return;
    this.onDelivered = onDelivered;
    this.phase = 'in';
    this.model.visible = true;
    this.#startDrive(this.startPos, this.deliverPos);
  }

  #startDrive(from, to) {
    const T = settings.supermarket.truck;
    this.drive = { t: 0, dur: T.driveDuration, from, to };
    this.model.position.set(from.x, 0, from.z);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (Math.hypot(dx, dz) > 1e-4) this.model.rotation.y = Math.atan2(dx, dz) + T.modelYRotationOffset;
  }

  update(dt) {
    if (this.phase === 'idle') return;

    if (this.drive) {
      this.drive.t += dt / this.drive.dur;
      const t = Math.min(1, this.drive.t);
      const e = easeInOut(t);
      this.model.position.x = this.drive.from.x + (this.drive.to.x - this.drive.from.x) * e;
      this.model.position.z = this.drive.from.z + (this.drive.to.z - this.drive.from.z) * e;
      if (t >= 1) {
        this.drive = null;
        if (this.phase === 'in') {
          this.onDelivered?.();
          this.onDelivered = null;
          this.phase = 'wait';
          this.waitT = settings.supermarket.truck.waitDuration;
        } else if (this.phase === 'out') {
          this.phase = 'idle';
          this.model.visible = false;
        }
      }
      return;
    }

    if (this.phase === 'wait') {
      this.waitT -= dt;
      if (this.waitT <= 0) {
        this.phase = 'out';
        this.#startDrive(this.deliverPos, this.startPos);
      }
    }
  }
}
