import * as THREE from 'three';
import settings from '../config/settings.js';
import { ownedRightX, allLandOwned, BAY_ZONE_Z } from '../core/upgrades.js';

/**
 * Garage — the environment: floor, subtle grid, the queue lane, low walls with
 * door gaps (entrance/exit), and the land fence. The lane + outer walls are
 * static (already-built infrastructure); the fence in the bay row slides
 * right as Expand Room is bought, with unpurchased land dimmed beyond it. The
 * pit lots/stations and all cars are dynamic and owned by CarYard/PitView.
 */
export class Garage {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.fenceX = null; // animated; snaps to the true value on the first update()

    this.#buildStatic();
    this.#buildFence();
  }

  update(dt, state) {
    const target = ownedRightX(state);
    this.fenceX = this.fenceX === null ? target : this.fenceX + (target - this.fenceX) * Math.min(1, 6 * dt);

    const owned = allLandOwned(state);
    this.fence.visible = !owned;
    this.forSale.visible = !owned;
    if (!owned) this.#applyFenceX(this.fenceX);
  }

  #buildStatic() {
    const group = new THREE.Group();
    const c = settings.colors;
    const W = settings.world;

    const floorW = W.halfX * 2;
    const floorD = W.halfZ * 2;
    const h = W.wallHeight;
    const t = W.wallThickness;
    const gz = settings.laneZ; // gates are centred on the shared lane
    const g = W.gateHalf;

    // Floor.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorW, floorD),
      new THREE.MeshStandardMaterial({ color: c.floor })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    // Subtle grid (1-unit cells).
    const grid = new THREE.GridHelper(Math.max(floorW, floorD), Math.max(floorW, floorD), c.grid, c.grid);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.25;
    group.add(grid);

    // Shared queue lane strip, running the full width along the gates.
    const lane = new THREE.Mesh(
      new THREE.PlaneGeometry(floorW, 2.4),
      new THREE.MeshStandardMaterial({ color: c.lane })
    );
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0.012, gz);
    lane.receiveShadow = true;
    group.add(lane);

    // Walls.
    const wallMat = new THREE.MeshStandardMaterial({ color: c.wall, flatShading: true });
    const wall = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    };

    // Front/back walls (solid, run along x).
    wall(floorW + t, t, 0, -W.halfZ - t / 2);
    wall(floorW + t, t, 0, W.halfZ + t / 2);

    // Left/right walls (run along z) split around the gate gap at z = gz.
    const segALen = gz - g - -W.halfZ; // lower segment length
    const segACenter = (-W.halfZ + (gz - g)) / 2;
    const segBLen = W.halfZ - (gz + g); // upper segment length
    const segBCenter = (gz + g + W.halfZ) / 2;
    for (const sx of [-W.halfX - t / 2, W.halfX + t / 2]) {
      wall(t, segALen, sx, segACenter);
      wall(t, segBLen, sx, segBCenter);
    }

    // Gate pillars + lintels at both doorways (entrance on +x, exit on -x).
    const gateMat = new THREE.MeshStandardMaterial({ color: c.gate, flatShading: true });
    const pillar = (x, z) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, h * 1.6, 0.6), gateMat);
      p.position.set(x, h * 0.8, z);
      p.castShadow = true;
      group.add(p);
    };
    const lintel = (x) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, g * 2 + 0.6), gateMat);
      l.position.set(x, h * 1.6, gz);
      l.castShadow = true;
      group.add(l);
    };
    for (const sx of [-W.halfX, W.halfX]) {
      pillar(sx, gz - g);
      pillar(sx, gz + g);
      lintel(sx);
    }

    this.sm.add(group);
  }

  /** The bay-row fence + the dimmed "for sale" land beyond it (both slide on x only). */
  #buildFence() {
    const c = settings.colors;
    const W = settings.world;
    const zFrom = BAY_ZONE_Z;
    const zTo = W.halfZ;
    const depth = zTo - zFrom;
    const zCenter = (zFrom + zTo) / 2;
    this.maxRightX = W.halfX;

    this.fence = new THREE.Mesh(
      new THREE.BoxGeometry(W.wallThickness, W.wallHeight * 0.6, depth),
      new THREE.MeshStandardMaterial({ color: c.fence, flatShading: true })
    );
    this.fence.position.y = (W.wallHeight * 0.6) / 2;
    this.fence.castShadow = true;
    this.sm.add(this.fence);

    // Unit-width plane: scale.x + position.x give the visible span without
    // ever rebuilding geometry as the fence slides.
    this.forSale = new THREE.Mesh(
      new THREE.PlaneGeometry(1, depth),
      new THREE.MeshStandardMaterial({ color: c.landLocked })
    );
    this.forSale.rotation.x = -Math.PI / 2;
    this.forSale.position.y = 0.013;
    this.forSale.position.z = zCenter;
    this.sm.add(this.forSale);
  }

  #applyFenceX(x) {
    this.fence.position.x = x;
    const width = Math.max(0.001, this.maxRightX - x);
    this.forSale.scale.x = width;
    this.forSale.position.x = x + width / 2;
  }
}
