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

    // A door's pillars + lintel + outside road (both walls) show once that
    // pit's land is bought.
    for (const d of [...this.backDoors, ...this.frontDoors]) {
      const open = state.pits[d.index].roomUnlocked;
      d.pillarL.visible = open;
      d.pillarR.visible = open;
      d.lintel.visible = open;
      d.road.visible = open;
      d.roadCenterLine.visible = open;
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

    // Bay/work-area patch: the rest of the floor, right of the lobby, slightly
    // darker so the pit row reads as a distinct work zone.
    const bayW = W.halfX - lobbyRightX;
    const bay = new THREE.Mesh(
      new THREE.PlaneGeometry(bayW, floorD),
      new THREE.MeshStandardMaterial({ color: c.pit })
    );
    bay.rotation.x = -Math.PI / 2;
    bay.position.set(lobbyRightX + bayW / 2, 0.012, 0);
    bay.receiveShadow = true;
    this.group.add(bay);

    const grid = new THREE.GridHelper(Math.max(floorW, floorD), Math.max(floorW, floorD), c.grid, c.grid);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.25;
    this.group.add(grid);

    this.#buildLaneMarkings(floorD);
    this.#buildPitDividers(floorD);
  }

  /** Yellow divider line between each pair of adjacent pit bays. */
  #buildPitDividers(floorD) {
    const c = settings.colors;
    const dividerMat = new THREE.MeshBasicMaterial({ color: c.roadLine });
    const positions = settings.pit.positions;

    for (let i = 0; i < positions.length - 1; i++) {
      const midX = (positions[i].x + positions[i + 1].x) / 2;
      const divider = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, floorD), dividerMat);
      divider.position.set(midX, 0.02, 0);
      this.group.add(divider);
    }
  }

  /** Painted guide lines + a dashed centre line down each pit's car lane. */
  #buildLaneMarkings(floorD) {
    const c = settings.colors;
    const stripeMat = new THREE.MeshBasicMaterial({ color: c.laneStripe });
    const laneHalf = 1.6; // half-width of the painted lane, inside the 4.2-wide pit footprint

    for (const pos of settings.pit.positions) {
      for (const side of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.12, floorD), stripeMat);
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(pos.x + side * laneHalf, 0.013, 0);
        this.group.add(edge);
      }

      // Zebra-style dashed centre line.
      const dashLen = 1.0;
      const step = dashLen + 0.8; // dash + gap
      for (let z = -floorD / 2 + step / 2; z <= floorD / 2; z += step) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.15, dashLen), stripeMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(pos.x, 0.014, z);
        this.group.add(dash);
      }
    }
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
    // Pillars + lintels + outside road for both door rows (entry on the back,
    // exit on the front). dir is which way is "outward" from the building.
    this.backDoors = this.#buildDoorRow(this.backWallZ, 1);
    this.frontDoors = this.#buildDoorRow(this.frontWallZ, -1);
  }

  #buildDoorRow(z, dir) {
    const c = settings.colors;
    const W = settings.world;
    const h = W.wallHeight;
    const g = W.gateHalf;
    const t = W.wallThickness;

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

    // Road outside the gate: same width as the opening, running outward
    // along the lane (z) axis far enough to suggest cars come from off-screen.
    // Dark asphalt with a dashed white centre line.
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x5a5a5a });
    const roadLength = 8;
    const outerZ = z + (dir * t) / 2; // the wall's outward-facing surface
    const roadZ = outerZ + (dir * roadLength) / 2;
    const road = (x) => {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(g * 2, roadLength), roadMat);
      r.rotation.x = -Math.PI / 2;
      r.position.set(x, 0.01, roadZ);
      r.receiveShadow = true;
      r.visible = false;
      this.group.add(r);
      return r;
    };

    const dashMat = new THREE.MeshBasicMaterial({ color: c.laneStripe });
    const dashLen = 1.0;
    const dashStep = dashLen + 0.8; // dash + gap
    const roadCenterLine = (x) => {
      const grp = new THREE.Group();
      grp.position.set(x, 0, roadZ);
      grp.visible = false;
      for (let dz = -roadLength / 2 + dashStep / 2; dz <= roadLength / 2; dz += dashStep) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, dashLen), dashMat);
        dash.position.set(0, 0.02, dz);
        grp.add(dash);
      }
      this.group.add(grp);
      return grp;
    };

    // One door per pit, at the pit's x (fixed). Toggled by roomUnlocked.
    return settings.pit.positions.map((pos, index) => ({
      index,
      pillarL: pillar(pos.x - g),
      pillarR: pillar(pos.x + g),
      lintel: lintel(pos.x),
      road: road(pos.x),
      roadCenterLine: roadCenterLine(pos.x),
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
