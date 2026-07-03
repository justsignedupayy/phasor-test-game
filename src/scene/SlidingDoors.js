import * as THREE from 'three';
import settings from '../config/settings.js';

/**
 * SlidingDoors — automatic sliding glass doors on the walk-in entrances: the
 * gas gate in the left wall, the market's customer entry + exit (back wall)
 * and the restock truck's delivery gate (front wall). Each door is two panels
 * (blue semi-transparent glass in a grey frame, built procedurally — no model)
 * that part from the centre when a mover comes within settings.slidingDoors.range
 * and glide shut once clear; the slide is eased over openDuration, never a snap.
 *
 * Render-only: reads core state (player/customer positions, unlock flags) and
 * the TruckView's animated position; writes nothing back. Each door shares its
 * entrance's existence flag (gas lot 0 / market unlocked), exactly like the
 * pillar+lintel frames Garage.update toggles.
 */
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

class Door {
  /** A door centred at (x, z) in the wall plane; rotationY turns the slide axis
   * onto the wall (0 = panels slide along world x, PI/2 = along world z). */
  constructor(parent, x, z, rotationY) {
    const D = settings.slidingDoors;
    const W = settings.world;
    this.x = x;
    this.z = z;
    // Two half-gap panels meet at the centre; each retracts by its own width,
    // clearing the full gateHalf*2 gap. Height stops under the lintel (Garage's
    // lintelH = 0.5) so an open door tucks inside the frame, not through it.
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
    this.#layout();
  }

  /** One panel: a glass pane wrapped in four grey edge bars, hung from a group
   * whose x is the slide offset (side -1 = left half, +1 = right half). */
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
      this.#layout();
      return;
    }
    const D = settings.slidingDoors;
    const near = movers.some((m) => Math.hypot(m.x - this.x, m.z - this.z) <= D.range);
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
  /** @param {() => THREE.Object3D} getTruckModel TruckView's animated truck (the
   * delivery door opens for it while it's visible/in flight). */
  constructor(sceneManager, getTruckModel) {
    this.getTruckModel = getTruckModel;

    const W = settings.world;
    const S = settings.supermarket;
    const root = new THREE.Group();
    sceneManager.add(root);

    // Same wall-plane anchors as Garage's door frames (front/back/left wall z/x).
    // The market panels (customer entry/exit + delivery) hang at the FAR end of
    // their corridors (customerDoorZ / deliveryDoorZ), not on the building wall
    // — see Garage.#buildMarketCorridors.
    this.gasDoor = new Door(root, -W.halfX - W.wallThickness / 2, settings.gasStation.gateZ, Math.PI / 2);
    this.marketEntryDoor = new Door(root, S.marketX, S.customerDoorZ, 0);
    this.marketExitDoor = new Door(root, S.marketExitX, S.customerDoorZ, 0);
    this.deliveryDoor = new Door(root, S.deliveryDoorX, S.deliveryDoorZ, 0);
  }

  update(dt, state) {
    const player = state.player.position;
    const marketOpen = state.supermarket.unlocked;

    this.gasDoor.update(dt, state.gasStation.pumps[0].roomUnlocked, [player]);

    // Customer doors open for anyone on foot: the player or any market customer.
    const walkers = [player, ...state.supermarket.customerQueue.map((c) => c.position)];
    this.marketEntryDoor.update(dt, marketOpen, walkers);
    this.marketExitDoor.update(dt, marketOpen, walkers);

    // The delivery gate opens for the player, the market worker (its restock
    // trips run this corridor) and the truck (scene-side tween).
    const deliveryMovers = [player];
    if (state.supermarket.worker) deliveryMovers.push(state.supermarket.worker.position);
    const truck = this.getTruckModel();
    if (truck && truck.visible) deliveryMovers.push({ x: truck.position.x, z: truck.position.z });
    this.deliveryDoor.update(dt, marketOpen, deliveryMovers);
  }
}
