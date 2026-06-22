import * as THREE from 'three';
import settings from '../config/settings.js';
import { ownedRightX } from '../core/upgrades.js';

/**
 * Garage — the environment: floor, grid, a left lobby patch, and four perimeter
 * walls. The building grows rightward as Expand Room is bought: the left wall is
 * anchored at x = -halfX while the right wall (and the right ends of the
 * front/back walls) slide to ownedRightX(state), animated each frame.
 *
 * Cars drive straight through, so each roomUnlocked pit gets a door gap at its x
 * on BOTH the back wall (z = +halfZ, entry) and the front wall (z = -halfZ,
 * exit), each flanked by gate pillars + a lintel. Locked pits keep solid wall on
 * both. The pit lots/stations and all cars are dynamic and owned by CarYard/PitView.
 */
export class Garage {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.rightWallX = null; // animated; snaps to the true value on the first update()

    this.group = new THREE.Group();
    this.#buildFloor();
    this.#buildWalls();
    this.#buildDoors();
    this.sm.add(this.group);
  }

  update(dt, state) {
    // Slide the right wall toward the owned boundary (same lerp the fence used).
    const target = ownedRightX(state);
    this.rightWallX =
      this.rightWallX === null ? target : this.rightWallX + (target - this.rightWallX) * Math.min(1, 6 * dt);

    this.#layoutRightWall(this.rightWallX);
    this.#layoutSegmentedWall(this.backSegments, this.backWallZ, this.rightWallX, state);
    this.#layoutSegmentedWall(this.frontSegments, this.frontWallZ, this.rightWallX, state);

    // A door's pillars + lintel (both walls) show once that pit's land is bought.
    for (const d of [...this.backDoors, ...this.frontDoors]) {
      const open = state.pits[d.index].roomUnlocked;
      d.pillarL.visible = open;
      d.pillarR.visible = open;
      d.lintel.visible = open;
    }
  }

  #buildFloor() {
    const c = settings.colors;
    const W = settings.world;
    const floorW = W.halfX * 2;
    const floorD = W.halfZ * 2;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorW, floorD),
      new THREE.MeshStandardMaterial({ color: c.floor })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Left lobby patch: a distinct floor colour from the left wall up to just
    // short of pit 0's lot, marking the pit-free, traffic-free lobby area.
    const lobbyRightX = settings.pit.positions[0].x - 2.5;
    const lobbyW = lobbyRightX - -W.halfX;
    const lobby = new THREE.Mesh(
      new THREE.PlaneGeometry(lobbyW, floorD),
      new THREE.MeshStandardMaterial({ color: c.lobby })
    );
    lobby.rotation.x = -Math.PI / 2;
    lobby.position.set(-W.halfX + lobbyW / 2, 0.012, 0);
    lobby.receiveShadow = true;
    this.group.add(lobby);

    const grid = new THREE.GridHelper(Math.max(floorW, floorD), Math.max(floorW, floorD), c.grid, c.grid);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.25;
    this.group.add(grid);
  }

  #buildWalls() {
    const W = settings.world;
    const h = W.wallHeight;
    const t = W.wallThickness;
    const depthZ = W.halfZ * 2 + t;

    this.wallMat = new THREE.MeshStandardMaterial({ color: settings.colors.wall, flatShading: true });
    const box = (w, d) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.wallMat);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };

    this.frontWallZ = -W.halfZ - t / 2;
    this.backWallZ = W.halfZ + t / 2;

    // Left wall: fixed at x = -halfX, solid, full depth.
    const left = box(t, depthZ);
    left.position.set(-W.halfX - t / 2, h / 2, 0);
    this.group.add(left);

    // Right wall: slides to rightWallX each frame (solid, full depth).
    this.rightWall = box(t, depthZ);
    this.group.add(this.rightWall);

    // Front + back walls: pools of unit-width segments; gaps are left at unlocked
    // pits' doors. maxPits doors → at most maxPits+1 solid segments per wall.
    this.backSegments = this.#buildSegmentPool(box);
    this.frontSegments = this.#buildSegmentPool(box);
  }

  #buildSegmentPool(box) {
    const W = settings.world;
    const pool = [];
    for (let i = 0; i < settings.maxPits + 1; i++) {
      const seg = box(1, W.wallThickness);
      seg.visible = false;
      this.group.add(seg);
      pool.push(seg);
    }
    return pool;
  }

  #buildDoors() {
    // Pillars + lintels for both door rows (entry on the back, exit on the front).
    this.backDoors = this.#buildDoorRow(this.backWallZ);
    this.frontDoors = this.#buildDoorRow(this.frontWallZ);
  }

  #buildDoorRow(z) {
    const c = settings.colors;
    const W = settings.world;
    const h = W.wallHeight;
    const g = W.gateHalf;

    const gateMat = new THREE.MeshStandardMaterial({ color: c.gate, flatShading: true });
    const pillar = (x) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, h * 1.6, 0.6), gateMat);
      p.position.set(x, h * 0.8, z);
      p.castShadow = true;
      p.visible = false;
      this.group.add(p);
      return p;
    };
    const lintel = (x) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(g * 2 + 0.6, 0.5, 0.6), gateMat);
      l.position.set(x, h * 1.6, z);
      l.castShadow = true;
      l.visible = false;
      this.group.add(l);
      return l;
    };

    // One door per pit, at the pit's x (fixed). Toggled by roomUnlocked.
    return settings.pit.positions.map((pos, index) => ({
      index,
      pillarL: pillar(pos.x - g),
      pillarR: pillar(pos.x + g),
      lintel: lintel(pos.x),
    }));
  }

  #layoutRightWall(rightX) {
    const W = settings.world;
    this.rightWall.position.set(rightX + W.wallThickness / 2, W.wallHeight / 2, 0);
  }

  /** Place a pool of wall segments to span [-halfX, rightX] minus each unlocked door gap. */
  #layoutSegmentedWall(segments, wallZ, rightX, state) {
    const W = settings.world;
    const g = W.gateHalf;
    const h = W.wallHeight;
    const leftX = -W.halfX;

    const doors = state.pits
      .filter((p) => p.roomUnlocked)
      .map((p) => settings.pit.positions[p.index].x)
      .sort((a, b) => a - b);

    const segs = [];
    let cursor = leftX;
    for (const dx of doors) {
      const gapStart = dx - g;
      if (gapStart > cursor) segs.push([cursor, gapStart]);
      cursor = Math.max(cursor, dx + g);
    }
    if (rightX > cursor) segs.push([cursor, rightX]);

    segments.forEach((mesh, i) => {
      const seg = segs[i];
      if (!seg) {
        mesh.visible = false;
        return;
      }
      const [a, b] = seg;
      const width = b - a;
      mesh.visible = width > 0.001;
      mesh.scale.x = Math.max(0.001, width);
      mesh.position.set((a + b) / 2, h / 2, wallZ);
    });
  }
}
