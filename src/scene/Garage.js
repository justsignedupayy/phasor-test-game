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
 * The supermarket gets a similar but asymmetric treatment, once unlocked:
 * customers get their own entry + exit doors, BOTH on the back wall (unlike a
 * pit's back/front pair) — entry at settings.supermarket.marketX, exit at
 * marketExitX just to its left — marketEntryDoor/marketExitDoor, built by the
 * same #buildDoorRow as the pit doors. A third, separate delivery door on the
 * FRONT wall (marketDeliveryDoor, at settings.supermarket.deliveryDoorX — parallel
 * to the pit exit doors) is for the restock truck only, never customers.
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
    this.#buildDeliveryRoad();
    this.sm.add(this.group);
  }

  update(dt, state) {
    // Slide the right wall toward the owned boundary (same lerp the fence used).
    const target = ownedRightX(state);
    this.rightWallX =
      this.rightWallX === null ? target : this.rightWallX + (target - this.rightWallX) * Math.min(1, 6 * dt);

    this.#layoutRightWall(this.rightWallX);
    const marketDoors = [settings.supermarket.marketX, settings.supermarket.marketExitX];
    this.#layoutSegmentedWall(this.backSegments, this.backWallZ, this.rightWallX, state, marketDoors);
    // The front wall carries the pit exit doors plus the supermarket's delivery gate.
    this.#layoutSegmentedWall(this.frontSegments, this.frontWallZ, this.rightWallX, state, [
      settings.supermarket.deliveryDoorX,
    ]);
    this.#layoutLeftWall();

    const marketOpen = state.supermarket.unlocked;

    // A door's pillars + lintel (both walls), plus the pit's blue floor spot and
    // exterior road section, all show once that pit's land is bought.
    for (const d of [...this.backDoors, ...this.frontDoors]) {
      const open = state.pits[d.index].roomUnlocked;
      d.pillarL.visible = open;
      d.pillarR.visible = open;
      d.lintel.visible = open;
    }

    // The customers' entry + exit doors (both on the back wall) and the restock
    // truck's delivery door (front wall) — same shape as a car's door, just at a
    // fixed x instead of per-pit. All three appear once the supermarket is open.
    for (const d of [this.marketEntryDoor, this.marketExitDoor, this.marketDeliveryDoor]) {
      d.pillarL.visible = marketOpen;
      d.pillarR.visible = marketOpen;
      d.lintel.visible = marketOpen;
    }
    // The restock truck's exterior travel road shares the delivery door's visibility.
    this.deliveryRoad.visible = marketOpen;
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

    const R = W.road;
    const roadMat = new THREE.MeshStandardMaterial({ color: c.road });

    // Roads run from each wall out to the road extent (past where cars spawn / drive
    // off), so they reach toward the world edge instead of stopping short of it.
    // Entry: behind the back wall (+z). Exit: in front of the front wall (-z).
    const entry = [W.halfZ, W.halfZ + R.extent];
    const exit = [-W.halfZ, -(W.halfZ + R.extent)];

    const addRoad = (group, x, [zNear, zFar]) => {
      const z0 = Math.min(zNear, zFar);
      const z1 = Math.max(zNear, zFar);
      const road = new THREE.Mesh(new THREE.PlaneGeometry(laneWidth, z1 - z0), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(x, 0.006, (z0 + z1) / 2); // just under the per-door roads (y=0.01)
      road.receiveShadow = true;
      group.add(road);
    };

    // One road section (entry + exit slab) per pit; visible only once that pit's land
    // is bought. The dashed centre line is drawn per lane by #buildLaneMarkings (one
    // clean line on the slab) — no inter-lane divider dashes are painted here.
    this.roadSections = positions.map((pos, index) => {
      const group = new THREE.Group();
      addRoad(group, pos.x, entry);
      addRoad(group, pos.x, exit);
      group.visible = false;
      this.group.add(group);
      return { index, group };
    });
  }

  /**
   * The restock truck's exterior road: a single slab along the truck's travel
   * path (a constant x — its deliver/start offsets share x=0 — so it tracks the
   * restock box's x), in front of the front-wall delivery gate. Matches the
   * per-pit exterior roads built in #buildExteriorRoads (same lane width, same
   * exit-slab z-span out to the road extent, same material + y) and carries the
   * same dashed centre line tuned by settings.world.road. Shown only once the
   * supermarket is open. The delivery entrance — the dock between the front wall
   * and the truck's drop-off spot, where the gate, restock pile and parked truck
   * sit — is left plain grey (no dashes), exactly the way #buildLaneMarkings
   * keeps dashes off the pit spots.
   */
  #buildDeliveryRoad() {
    const c = settings.colors;
    const W = settings.world;
    const R = W.road;
    const S = settings.supermarket;
    const P = settings.pit;

    // Same lane width as a pit's exterior road section, so it reads identically.
    const positions = P.positions;
    const laneWidth = positions.length > 1 ? Math.abs(positions[1].x - positions[0].x) : 4.5;

    // Truck path: constant x = restock box x; span the exit slab (front wall out
    // to the road extent), matching #buildExteriorRoads' exit road exactly.
    const truckX = S.restockBoxPosition.x + S.truck.deliverOffset.x;
    const z0 = -(W.halfZ + R.extent);
    const z1 = -W.halfZ;

    const group = new THREE.Group();

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(laneWidth, z1 - z0),
      new THREE.MeshStandardMaterial({ color: c.road })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(truckX, 0.006, (z0 + z1) / 2); // matches the per-pit slabs' y
    road.receiveShadow = true;
    group.add(road);

    // Dashed centre line: same tunables/logic as #buildLaneMarkings, but kept off
    // the delivery entrance — the dock from the front wall out to the truck's
    // drop-off spot stays plain grey, like dashes are kept off the pit spots.
    const stripeMat = new THREE.MeshBasicMaterial({ color: c.laneStripe });
    const dashLen = R.dashLength;
    const step = dashLen + R.dashGap;
    const entranceFarZ = S.restockBoxPosition.z + S.truck.deliverOffset.z; // truck's drop-off / dock edge
    const inEntrance = (z) => z >= entranceFarZ - dashLen / 2 && z <= z1;
    for (let z = z0 + step / 2; z + dashLen / 2 <= z1; z += step) {
      if (inEntrance(z)) continue; // never paint over the delivery dock
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.15, dashLen), stripeMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(truckX, 0.014, z);
      group.add(dash);
    }

    group.visible = false;
    this.group.add(group);
    this.deliveryRoad = group;
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
    const W = settings.world;
    const R = W.road;
    const P = settings.pit;
    const stripeMat = new THREE.MeshBasicMaterial({ color: c.laneStripe });
    const laneHalf = 1.6; // half-width of the painted lane, inside the 4.2-wide pit footprint

    const dashLen = R.dashLength;
    const step = dashLen + R.dashGap; // dash + gap

    // The dashed centre line is painted ONLY on the actual road slabs — the entry +
    // exit slabs built in #buildExteriorRoads — never on the bare garage floor between
    // them and never over a pit. These two [near, far] z spans MUST match the slabs.
    const slabs = [
      [W.halfZ, W.halfZ + R.extent], // entry road, behind the back wall
      [-(W.halfZ + R.extent), -W.halfZ], // exit road, in front of the front wall
    ];
    // No dash may fall within a pit's full blue-spot footprint (defensive — the slabs
    // are already clear of the pits, but this guarantees it even if they move).
    const overPit = (z) =>
      P.positions.some((pos) => Math.abs(z - pos.z) < P.spotDepth / 2 + dashLen / 2);

    this.laneMarkings = P.positions.map((pos, index) => {
      const group = new THREE.Group();

      // Lane edge stripes span the building floor depth (the lane through the garage).
      for (const side of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.12, floorD), stripeMat);
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(pos.x + side * laneHalf, 0.013, 0);
        group.add(edge);
      }

      // One clean centre dash line per lane: a run of evenly-spaced dashes per road
      // slab, each fully inside the slab (its ends never spill past the slab edge).
      for (const [zNear, zFar] of slabs) {
        const z0 = Math.min(zNear, zFar);
        const z1 = Math.max(zNear, zFar);
        for (let z = z0 + step / 2; z + dashLen / 2 <= z1; z += step) {
          if (overPit(z)) continue; // never paint over a pit
          const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.15, dashLen), stripeMat);
          dash.rotation.x = -Math.PI / 2;
          dash.position.set(pos.x, 0.014, z);
          group.add(dash);
        }
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

    // Left wall: solid, full depth (the restock door moved to the front wall as
    // the truck's delivery gate). Still laid out from a small segment pool — the
    // same machinery as the other walls — but it never carves a gap now.
    this.leftSegments = this.#buildLeftWallSegments(box);

    // Right wall: slides to rightWallX each frame (solid, full depth).
    this.rightWall = box(t, depthZ);
    this.group.add(this.rightWall);

    // Front + back walls: pools of unit-width segments; gaps are left at unlocked
    // pits' doors, plus the market's doors once unlocked (entry + exit on the back
    // wall, the truck's delivery gate on the front). Back: maxPits+2 doors total →
    // at most maxPits+3 solid segments. Front: maxPits+1 doors → at most maxPits+2.
    this.backSegments = this.#buildSegmentPool(box, settings.maxPits + 3);
    this.frontSegments = this.#buildSegmentPool(box, settings.maxPits + 2);
  }

  #buildSegmentPool(box, count) {
    const W = settings.world;
    const pool = [];
    for (let i = 0; i < count; i++) {
      const seg = box(1, W.wallThickness);
      seg.visible = false;
      this.group.add(seg);
      pool.push(seg);
    }
    return pool;
  }

  /** The left wall is solid; one segment covers it (pool kept at 2 for symmetry). */
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
    // Pillars + lintels for both pit door rows (entry on the back, exit on the
    // front). No per-door apron centre dashes anywhere: the lane/road centre
    // lines (#buildLaneMarkings / #buildDeliveryRoad) already cover every
    // travelled apron, and the customer door zones are deliberately kept plain.
    this.backDoors = this.#buildDoorRow(this.backWallZ);
    this.frontDoors = this.#buildDoorRow(this.frontWallZ);

    // The supermarket's own entry/exit: same builder, but BOTH doors sit on the
    // back wall — the exit at marketExitX, to the entry's left, instead of clear
    // across the building on the front wall.
    this.marketEntryDoor = this.#buildDoorRow(this.backWallZ, [settings.supermarket.marketX])[0];
    this.marketExitDoor = this.#buildDoorRow(this.backWallZ, [settings.supermarket.marketExitX])[0];

    // The restock truck's delivery door: a single gate on the FRONT wall, at
    // deliveryDoorX — parallel to the pit exit doors. The truck pulls up to its
    // exterior road and stays at the gate (see scene/TruckView.js).
    this.marketDeliveryDoor = this.#buildDoorRow(this.frontWallZ, [settings.supermarket.deliveryDoorX])[0];
  }

  #buildDoorRow(z, xs = settings.pit.positions.map((p) => p.x)) {
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

    // One door per x given (pit positions by default). Toggled by the caller.
    // No apron slab or centre line is drawn here: the exterior road slabs and
    // their dashed lines (#buildExteriorRoads / #buildDeliveryRoad) already cover
    // every travelled gate apron.
    return xs.map((x, index) => ({
      index,
      pillarL: pillar(x - g),
      pillarR: pillar(x + g),
      lintel: lintel(x),
    }));
  }

  #layoutRightWall(rightX) {
    const W = settings.world;
    this.rightWall.position.set(rightX + W.wallThickness / 2, W.wallHeight / 2, 0);
  }

  /**
   * Place a pool of wall segments to span [-halfX, rightX] minus each unlocked
   * door gap. marketDoorXs is this wall's own market door x's (both live on the
   * back wall now — pass [] for the front wall, which no longer has one).
   */
  #layoutSegmentedWall(segments, wallZ, rightX, state, marketDoorXs) {
    const W = settings.world;
    const g = W.gateHalf;
    const h = W.wallHeight;
    const leftX = -W.halfX;

    const doors = state.pits.filter((p) => p.roomUnlocked).map((p) => settings.pit.positions[p.index].x);
    if (state.supermarket.unlocked) doors.push(...marketDoorXs);
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

  /** Place the left wall: solid, full depth (the restock door moved to the front
   * wall as the delivery gate, so the left wall no longer has a gap). */
  #layoutLeftWall() {
    const W = settings.world;
    const h = W.wallHeight;
    const x = -W.halfX - W.wallThickness / 2;
    const z0 = -W.halfZ;
    const z1 = W.halfZ;

    this.leftSegments.forEach((mesh, i) => {
      if (i !== 0) {
        mesh.visible = false; // single solid span needs only the first segment
        return;
      }
      mesh.visible = true;
      mesh.scale.z = Math.max(0.001, z1 - z0);
      mesh.position.set(x, h / 2, (z0 + z1) / 2);
    });
  }
}
