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
 *
 * The supermarket gets the same treatment, once unlocked: customers get their
 * own back-wall entry + front-wall exit door at a fixed x (settings.supermarket.
 * marketX) — marketEntryDoor/marketExitDoor, built by the same #buildDoorRow as
 * the pit doors. A third, separate door in the LEFT wall (restockDoor) is for
 * restocking only — the player carrying boxes, never customers.
 */
export class Garage {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.rightWallX = null; // animated; snaps to the true value on the first update()

    this.group = new THREE.Group();
    this.#buildFloor();
    this.#buildExteriorRoads();
    this.#buildPitSpots();
    this.#buildWalls();
    this.#buildDoors();
    this.#buildRestockDoor();
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
    this.#layoutLeftWall(state);

    // The restock door's pillars/lintel/exterior road show once the supermarket
    // is unlocked — same affordance pattern as a pit door, but gated on the
    // supermarket purchase instead of roomUnlocked. Restocking only — customers
    // never use this one.
    const marketOpen = state.supermarket.unlocked;
    this.restockDoor.pillarNear.visible = marketOpen;
    this.restockDoor.pillarFar.visible = marketOpen;
    this.restockDoor.lintel.visible = marketOpen;
    this.restockDoor.road.visible = marketOpen;

    // A door's pillars + lintel + outside road (both walls), plus the pit's blue
    // floor spot and exterior road section, all show once that pit's land is bought.
    for (const d of [...this.backDoors, ...this.frontDoors]) {
      const open = state.pits[d.index].roomUnlocked;
      d.pillarL.visible = open;
      d.pillarR.visible = open;
      d.lintel.visible = open;
      d.road.visible = open;
      d.roadCenterLine.visible = open;
    }

    // The customers' own entry (back wall) + exit (front wall) doors — same
    // shape as a car's pair of doors, just at a fixed x instead of per-pit.
    for (const d of [this.marketEntryDoor, this.marketExitDoor]) {
      d.pillarL.visible = marketOpen;
      d.pillarR.visible = marketOpen;
      d.lintel.visible = marketOpen;
      d.road.visible = marketOpen;
      d.roadCenterLine.visible = marketOpen;
    }
    for (const s of this.pitSpots) {
      s.spot.visible = state.pits[s.index].roomUnlocked;
    }
    for (const r of this.roadSections) {
      r.group.visible = state.pits[r.index].roomUnlocked;
    }

    // Lane markings show with their own pit; a divider shows only when both of
    // its neighbouring pits are unlocked.
    for (const m of this.laneMarkings) {
      m.group.visible = state.pits[m.index].roomUnlocked;
    }
    for (const d of this.pitDividers) {
      d.mesh.visible = state.pits[d.a].roomUnlocked && state.pits[d.b].roomUnlocked;
    }

    // Clip the lobby + bay floor patches so neither shows beyond the owned wall.
    this.#clipFloorPatch(this.lobbyPatch);
    this.#clipFloorPatch(this.bayPatch);
  }

  /** Scale + reposition a floor patch so its right edge tracks the owned wall. */
  #clipFloorPatch({ mesh, leftX, baseW, maxRightX }) {
    const rightX = Math.min(maxRightX, this.rightWallX);
    const w = Math.max(0.001, rightX - leftX);
    mesh.scale.x = w / baseW;
    mesh.position.x = leftX + w / 2;
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
    // Clipped each frame so the floor never shows beyond the owned right wall.
    this.lobbyPatch = { mesh: lobby, leftX: -W.halfX, baseW: lobbyW, maxRightX: lobbyRightX };

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
    this.bayPatch = { mesh: bay, leftX: lobbyRightX, baseW: bayW, maxRightX: W.halfX };

    // A single yellow-line grid (both the centre-cross and the cell lines use the
    // same yellow), reading as subtle lane markings on the floor. GridHelper draws
    // only line segments, so there are no filled cells — just the floor showing
    // through between the yellow lines.
    const grid = new THREE.GridHelper(Math.max(floorW, floorD), Math.max(floorW, floorD), c.roadLine, c.roadLine);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.00;
    this.group.add(grid);

    this.#buildLaneMarkings(floorD);
    this.#buildPitDividers(floorD);
  }

  /** Yellow divider line between each pair of adjacent pit bays; shown only when
   * both neighbouring pits are roomUnlocked. */
  #buildPitDividers(floorD) {
    const c = settings.colors;
    const dividerMat = new THREE.MeshBasicMaterial({ color: c.roadLine });
    const positions = settings.pit.positions;

    this.pitDividers = [];
    for (let i = 0; i < positions.length - 1; i++) {
      const midX = (positions[i].x + positions[i + 1].x) / 2;
      const divider = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, floorD), dividerMat);
      divider.position.set(midX, 0.02, 0);
      divider.visible = false;
      this.group.add(divider);
      this.pitDividers.push({ a: i, b: i + 1, mesh: divider });
    }
  }

  /**
   * The exterior road outside the building, split into one section per pit: an
   * entry-road slab behind the back wall (z > halfZ, where queued cars line up)
   * and an exit-road slab in front of the front wall (z < -halfZ, where fixed
   * cars drive off), plus the dashed lane divider on the section's left edge.
   * Each section is its own group, hidden until that pit's land is bought.
   */
  #buildExteriorRoads() {
    const c = settings.colors;
    const W = settings.world;
    const P = settings.pit;
    const positions = P.positions;

    // Each section is one lane wide, centred on its pit column; adjacent sections
    // meet edge-to-edge so an unlocked row reads as one continuous road.
    const laneWidth = positions.length > 1 ? Math.abs(positions[1].x - positions[0].x) : 4.5;

    const roadMat = new THREE.MeshStandardMaterial({ color: c.road });
    const dashMat = new THREE.MeshBasicMaterial({ color: c.laneStripe });
    const dashLen = 1.5;
    const dashStep = dashLen; // dash + gap

    // Entry: from the back wall out to where the last queue slot ends.
    const entry = [W.halfZ, P.doorZ + settings.spawn.maxQueuePerPit * P.queueSlotDepth];
    // Exit: from the front wall out to where exiting cars fully disappear.
    const exit = [-W.halfZ, -(W.halfZ + P.queueSlotDepth * 2)];

    const addRoad = (group, x, [zNear, zFar]) => {
      const z0 = Math.min(zNear, zFar);
      const z1 = Math.max(zNear, zFar);
      const road = new THREE.Mesh(new THREE.PlaneGeometry(laneWidth, z1 - z0), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(x, 0.006, (z0 + z1) / 2); // just under the per-door roads (y=0.01)
      road.receiveShadow = true;
      group.add(road);
    };

    const addDashes = (group, dx, [zNear, zFar]) => {
      const z0 = Math.min(zNear, zFar);
      const z1 = Math.max(zNear, zFar);
      for (let z = z0 + dashStep / 2; z <= z1; z += dashStep) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.15, dashLen), dashMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(dx, 0.008, z);
        group.add(dash);
      }
    };

    // One road section per pit; visible only once that pit's land is bought.
    this.roadSections = positions.map((pos, index) => {
      const group = new THREE.Group();
      addRoad(group, pos.x, entry);
      addRoad(group, pos.x, exit);
      // Dashed divider against the previous (left) column.
      if (index > 0) {
        const dx = (positions[index - 1].x + pos.x) / 2;
        addDashes(group, dx, entry);
        addDashes(group, dx, exit);
      }
      group.visible = false;
      this.group.add(group);
      return { index, group };
    });
  }

  /** A blue, car-sized rectangle painted on the floor at every pit; hidden until
   * that pit's land is bought. */
  #buildPitSpots() {
    const P = settings.pit;
    const spotMat = new THREE.MeshBasicMaterial({ color: settings.colors.pitSpot });
    this.pitSpots = P.positions.map((pos, index) => {
      const spot = new THREE.Mesh(new THREE.PlaneGeometry(P.spotWidth, P.spotDepth), spotMat);
      spot.rotation.x = -Math.PI / 2;
      spot.position.set(pos.x, 0.015, pos.z); // above the floor markings to avoid z-fighting
      spot.visible = false;
      this.group.add(spot);
      return { index, spot };
    });
  }

  /** Painted guide lines + a dashed centre line down each pit's car lane; each
   * pit's markings are grouped and shown only when that pit is roomUnlocked. */
  #buildLaneMarkings(floorD) {
    const c = settings.colors;
    const stripeMat = new THREE.MeshBasicMaterial({ color: c.laneStripe });
    const laneHalf = 1.6; // half-width of the painted lane, inside the 4.2-wide pit footprint

    this.laneMarkings = settings.pit.positions.map((pos, index) => {
      const group = new THREE.Group();

      for (const side of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.12, floorD), stripeMat);
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(pos.x + side * laneHalf, 0.013, 0);
        group.add(edge);
      }

      // Zebra-style dashed centre line.
      const dashLen = 1.0;
      const step = dashLen + 50; // dash + gap
      for (let z = -floorD / 2 + step / 2; z <= floorD / 2; z += step) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.15, dashLen), stripeMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(pos.x, 0.014, z);
        group.add(dash);
      }

      group.visible = false;
      this.group.add(group);
      return { index, group };
    });
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

    // Left wall: solid, except for one gap (the supermarket's door) that opens
    // once the supermarket is unlocked — same segment-pool trick as the front/
    // back walls' pit doors, just along z instead of x, and with a single
    // door that never moves (so only 2 segments are ever needed).
    this.leftSegments = this.#buildLeftWallSegments(box);

    // Right wall: slides to rightWallX each frame (solid, full depth).
    this.rightWall = box(t, depthZ);
    this.group.add(this.rightWall);

    // Front + back walls: pools of unit-width segments; gaps are left at unlocked
    // pits' doors plus the market's entry/exit door once unlocked. maxPits+1
    // doors total → at most maxPits+2 solid segments per wall.
    this.backSegments = this.#buildSegmentPool(box);
    this.frontSegments = this.#buildSegmentPool(box);
  }

  #buildSegmentPool(box) {
    const W = settings.world;
    const pool = [];
    for (let i = 0; i < settings.maxPits + 2; i++) {
      const seg = box(1, W.wallThickness);
      seg.visible = false;
      this.group.add(seg);
      pool.push(seg);
    }
    return pool;
  }

  /** The left wall has at most one gap (the market door), so 2 segments cover it. */
  #buildLeftWallSegments(box) {
    const pool = [];
    for (let i = 0; i < 2; i++) {
      const seg = box(settings.world.wallThickness, 1);
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

    // The supermarket's own entry/exit: same builder, one door each, at a
    // fixed x (not per-pit) — mirrors a car's back/front door pair exactly.
    const marketX = [settings.supermarket.marketX];
    this.marketEntryDoor = this.#buildDoorRow(this.backWallZ, 1, marketX)[0];
    this.marketExitDoor = this.#buildDoorRow(this.frontWallZ, -1, marketX)[0];
  }

  #buildDoorRow(z, dir, xs = settings.pit.positions.map((p) => p.x)) {
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

    // One door per x given (pit positions by default). Toggled by the caller.
    return xs.map((x, index) => ({
      index,
      pillarL: pillar(x - g),
      pillarR: pillar(x + g),
      lintel: lintel(x),
      road: road(x),
      roadCenterLine: roadCenterLine(x),
    }));
  }

  /**
   * The restock-only door: a single gap in the LEFT wall (rotated 90° from the
   * pit/market doors, whose gaps run along x at a fixed z — this one runs
   * along z at the fixed x = -halfX). Toggled by state.supermarket.unlocked.
   * Only the player (carrying boxes) ever uses this one — customers use their
   * own back/front-wall doors instead (see #buildDoors' marketEntryDoor/
   * marketExitDoor).
   */
  #buildRestockDoor() {
    const c = settings.colors;
    const W = settings.world;
    const M = settings.supermarket;
    const h = W.wallHeight;
    const g = W.gateHalf;
    const t = W.wallThickness;
    const x = -W.halfX;

    const gateMat = new THREE.MeshStandardMaterial({ color: c.gate, flatShading: true });
    const pillar = (z) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, h * 1.6, 0.6), gateMat);
      p.position.set(x, h * 0.8, z);
      p.castShadow = true;
      p.visible = false;
      this.group.add(p);
      return p;
    };

    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, g * 2 + 0.6), gateMat);
    lintel.position.set(x, h * 1.6, M.restockDoorZ);
    lintel.castShadow = true;
    lintel.visible = false;
    this.group.add(lintel);

    // Exterior path, running outward (-x) from the gap, wide enough to reach
    // the restock pile beyond the wall.
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x5a5a5a });
    const roadLength = 8;
    const outerX = x - t / 2;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(roadLength, g * 2), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(outerX - roadLength / 2, 0.01, M.restockDoorZ);
    road.receiveShadow = true;
    road.visible = false;
    this.group.add(road);

    this.restockDoor = { pillarNear: pillar(M.restockDoorZ - g), pillarFar: pillar(M.restockDoorZ + g), lintel, road };
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

    const doors = state.pits.filter((p) => p.roomUnlocked).map((p) => settings.pit.positions[p.index].x);
    if (state.supermarket.unlocked) doors.push(settings.supermarket.marketX);
    doors.sort((a, b) => a - b);

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

  /** Place the left wall's (at most 2) segments to span [-halfZ, halfZ] minus the restock door's gap. */
  #layoutLeftWall(state) {
    const W = settings.world;
    const M = settings.supermarket;
    const g = W.gateHalf;
    const h = W.wallHeight;
    const x = -W.halfX - W.wallThickness / 2;
    const z0 = -W.halfZ;
    const z1 = W.halfZ;

    const segs = [];
    if (state.supermarket.unlocked) {
      const gapStart = M.restockDoorZ - g;
      const gapEnd = M.restockDoorZ + g;
      if (gapStart > z0) segs.push([z0, gapStart]);
      if (z1 > gapEnd) segs.push([gapEnd, z1]);
    } else {
      segs.push([z0, z1]);
    }

    this.leftSegments.forEach((mesh, i) => {
      const seg = segs[i];
      if (!seg) {
        mesh.visible = false;
        return;
      }
      const [a, b] = seg;
      const depth = b - a;
      mesh.visible = depth > 0.001;
      mesh.scale.z = Math.max(0.001, depth);
      mesh.position.set(x, h / 2, (a + b) / 2);
    });
  }
}
