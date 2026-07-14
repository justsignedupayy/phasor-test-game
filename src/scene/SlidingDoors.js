import * as THREE from 'three';
import settings from '../config/settings.js';
import { playDoorOpenSound, playDoorCloseSound } from '../platform/audio.js';

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

class Door {
  constructor(parent, x, z, rotationY) {
    const D = settings.slidingDoors;
    const W = settings.world;
    this.x = x;
    this.z = z;
    this.panelW = W.gateHalf;
    const panelH = W.wallHeight - 0.5;

    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    this.group.rotation.y = rotationY;
    this.left = this.#buildPanel(-1, this.panelW, panelH, D);
    this.right = this.#buildPanel(1, this.panelW, panelH, D);
    this.group.visible = false;
    parent.add(this.group);

    this.openness = 0; // 0 = shut, 1 = fully parted; eased into panel offsets
    this.near = false; // previous frame's proximity, for open/close sound edge-detection
    this.#layout();
  }

  #buildPanel(side, w, h, D) {
    const panel = new THREE.Group();

    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, D.panelThickness * 0.5),
      new THREE.MeshStandardMaterial({
        color: D.glassColor,
        transparent: true,
        opacity: D.glassOpacity,
        depthWrite: false, // transparent pane: avoid sorting artifacts against rings/spots
      })
    );
    glass.position.y = h / 2;
    panel.add(glass);

    const frameMat = new THREE.MeshStandardMaterial({ color: D.frameColor });
    const t = D.frameBar;
    const bar = (bw, bh, bx, by) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, D.panelThickness), frameMat);
      m.position.set(bx, by, 0);
      m.castShadow = true;
      panel.add(m);
    };
    bar(w, t, 0, h - t / 2); // top
    bar(w, t, 0, t / 2); // bottom
    bar(t, h, -w / 2 + t / 2, h / 2); // inner/outer edges
    bar(t, h, w / 2 - t / 2, h / 2);

    this.group.add(panel);
    return panel;
  }

  update(dt, active, movers) {
    this.group.visible = active;
    if (!active) {
      this.openness = 0;
      this.near = false;
      this.#layout();
      return;
    }
    const D = settings.slidingDoors;
    const near = movers.some((m) => Math.hypot(m.x - this.x, m.z - this.z) <= D.range);
    if (near && !this.near) playDoorOpenSound();
    else if (!near && this.near) playDoorCloseSound();
    this.near = near;
    this.openness = Math.min(1, Math.max(0, this.openness + (near ? dt : -dt) / D.openDuration));
    this.#layout();
  }

  #layout() {
    const slide = this.panelW * easeInOut(this.openness);
    this.left.position.x = -this.panelW / 2 - slide;
    this.right.position.x = this.panelW / 2 + slide;
  }
}

export class SlidingDoors {
  constructor(sceneManager, getTruckModel) {
    this.getTruckModel = getTruckModel;

    const W = settings.world;
    const S = settings.supermarket;
    const root = new THREE.Group();
    sceneManager.add(root);

    this.gasDoor = new Door(root, -W.halfX - W.wallThickness / 2, settings.gasStation.gateZ, Math.PI / 2);
    this.marketEntryDoor = new Door(root, S.marketX, S.customerDoorZ, 0);
    this.marketExitDoor = new Door(root, S.marketExitX, S.customerDoorZ, 0);
    this.deliveryDoor = new Door(root, S.deliveryDoorX, S.deliveryDoorZ, 0);
  }

  update(dt, state) {
    const player = state.player.position;
    const marketOpen = state.supermarket.unlocked;

    this.gasDoor.update(dt, state.gasStation.pumps[0].roomUnlocked, [player]);

    const walkers = [player, ...state.supermarket.customerQueue.map((c) => c.position)];
    this.marketEntryDoor.update(dt, marketOpen, walkers);
    this.marketExitDoor.update(dt, marketOpen, walkers);

    const deliveryMovers = [player];
    if (state.supermarket.worker) deliveryMovers.push(state.supermarket.worker.position);
    const truck = this.getTruckModel();
    if (truck && truck.visible) deliveryMovers.push({ x: truck.position.x, z: truck.position.z });
    this.deliveryDoor.update(dt, marketOpen, deliveryMovers);
  }
}
