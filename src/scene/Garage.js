import * as THREE from 'three';
import settings from '../config/settings.js';
import { ownedRightX } from '../core/upgrades.js';
import { fitBrickSpan, makeAsphaltMaterial, makeBrickWallMaterials, makeFloorMaterial } from './groundTextures.js';

// Door-frame pillar cross-section (a PILLAR_W × wallHeight × PILLAR_W box).
// Shared by the frame builders AND the wall layout: pillar-framed door gaps are
// widened by PILLAR_W / 2 per side so the wall segments BUTT against the
// pillars' outer faces (and lintels span between their inner faces) instead of
// overlapping them — overlapping boxes with coplanar tops z-fight.
const PILLAR_W = 0.6;

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
 * customers get their own entry + exit openings, BOTH on the back wall (unlike a
 * pit's back/front pair) — entry at settings.supermarket.marketX, exit at
 * marketExitX just to its left. Each opening extends OUTWARD as a walled
 * corridor (#buildCustomerCorridors), and the actual door frame
 * (marketEntryDoor/marketExitDoor, built by the same #buildDoorRow as the pit
 * doors) stands at the corridor's FAR end (customerDoorZ) — the back wall keeps
 * its gap as the corridor mouth. A third, separate delivery door on the
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
    const gasOpen = state.gasStation.pumps[0].roomUnlocked;
    this.#layoutLeftWall(gasOpen);

    const marketOpen = state.supermarket.unlocked;

    // A door's pillars + lintel (both walls), plus the pit's exterior road
    // section, all show once that pit's land is bought.
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
    // The corridors (floor + side walls) and the floor's tile grid share the
    // market doors' visibility.
    this.marketCorridors.visible = marketOpen;
    this.marketFloorGrid.visible = marketOpen;
    // The restock truck's exterior travel road shares the delivery door's visibility.
    this.deliveryRoad.visible = marketOpen;

    // The gas gate's pillars + lintel appear with the station's first lot.
    this.gasGateDoor.pillarL.visible = gasOpen;
    this.gasGateDoor.pillarR.visible = gasOpen;
    this.gasGateDoor.lintel.visible = gasOpen;
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

    // All three floor sheets get the tileable concrete grain map (their colour
    // stays the settings tunable — the map is a neutral multiplier).
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorW, floorD),
      makeFloorMaterial(c.floor, floorW, floorD)
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Left lobby patch: a distinct floor colour from the left wall up to just
    // short of pit 0's lot, marking the pit-free, traffic-free lobby area.
    const lobbyRightX = settings.supermarket.lobbyRightX;
    const lobbyW = lobbyRightX - -W.halfX;
    const lobby = new THREE.Mesh(
      new THREE.PlaneGeometry(lobbyW, floorD),
      makeFloorMaterial(c.lobby, lobbyW, floorD)
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
      makeFloorMaterial(c.pit, bayW, floorD)
    );
    bay.rotation.x = -Math.PI / 2;
    bay.position.set(lobbyRightX + bayW / 2, 0.012, 0);
    bay.receiveShadow = true;
    this.group.add(bay);
    this.bayPatch = { mesh: bay, leftX: lobbyRightX, baseW: bayW, maxRightX: W.halfX };

    this.#buildMarketFloorGrid(lobbyRightX, floorD);
    this.#buildLaneMarkings(floorD);
    this.#buildPitDividers(floorD);
  }

  /**
   * Square-tile grid painted over the market's floor (the lobby patch, which is
   * the shop's footprint): thin line strips in the lane-marking style, one set
   * running along z and one along x, spaced settings.supermarket.floorTileSize
   * apart. Shown only once the supermarket is open (see update()).
   */
  #buildMarketFloorGrid(lobbyRightX, floorD) {
    const W = settings.world;
    const tile = settings.supermarket.floorTileSize;
    const lineMat = new THREE.MeshBasicMaterial({ color: settings.colors.marketTileLine });
    const group = new THREE.Group();
    const leftX = -W.halfX;
    const width = lobbyRightX - leftX;

    // Interior lines only — the walls and the lobby/bay seam already edge the area.
    for (let x = leftX + tile; x < lobbyRightX - 1e-6; x += tile) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.06, floorD), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.0125, 0); // above the lobby patch (0.012), under the lane paint (0.013)
      group.add(line);
    }
    for (let z = -W.halfZ + tile; z < W.halfZ - 1e-6; z += tile) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.06), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(leftX + width / 2, 0.0125, z);
      group.add(line);
    }

    group.visible = false;
    this.group.add(group);
    this.marketFloorGrid = group;
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
    const W = settings.world;
    const P = settings.pit;
    const positions = P.positions;

    // Each section is one lane wide, centred on its pit column; adjacent sections
    // meet edge-to-edge so an unlocked row reads as one continuous road.
    const laneWidth = positions.length > 1 ? Math.abs(positions[1].x - positions[0].x) : 4.5;

    const R = W.road;
    // Procedural asphalt (grain + worn mottling); every slab here is
    // laneWidth × extent, so one shared material's repeat fits them all.
    const roadMat = makeAsphaltMaterial(laneWidth, R.extent);

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
      makeAsphaltMaterial(laneWidth, z1 - z0)
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
    // Full outer depth: reaches the front/back walls' OUTER faces (±(halfZ + t))
    // so both right corners are filled flush — no gap where the bands meet.
    const depthZ = W.halfZ * 2 + 2 * t;

    // Every wall piece gets its OWN per-face brick materials (not one shared
    // material): texture repeat/offset are per-texture state, the side/end/top
    // faces need different repeats to avoid stretching, and the pooled
    // segments are rescaled per frame — each one's run-dependent faces are
    // refit to its world span by fitBrickSpan in the layout passes. runW is
    // the piece's build-time run length (1 for pooled segments, refit later);
    // runAxis is the world axis the wall runs along.
    const box = (w, d, runW, runAxis) => {
      const depth = runAxis === 'x' ? d : w; // wall thickness across the run
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        makeBrickWallMaterials(runW, h, depth, runAxis)
      );
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };

    this.frontWallZ = -W.halfZ - t / 2;
    this.backWallZ = W.halfZ + t / 2;

    // Left wall: solid until the gas station's first lot is bought, then a gate
    // opens at gasStation.gateZ through which the player walks out to the pump
    // row in the world's left quadrant. Laid out from a small segment pool,
    // same machinery as the other walls.
    this.leftSegments = this.#buildLeftWallSegments(box);

    // Right wall: slides to rightWallX each frame (solid, full depth — it only
    // translates, never rescales, so its brick tiling is set once here).
    this.rightWall = box(t, depthZ, depthZ, 'z');
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
      const seg = box(1, W.wallThickness, 1, 'x');
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
      const seg = box(settings.world.wallThickness, 1, 1, 'z');
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

    // The supermarket's own entry/exit: same builder, but BOTH openings sit on
    // the back wall — the exit at marketExitX, to the entry's left, instead of
    // clear across the building on the front wall. The frames stand at the FAR
    // end of the customer corridors (customerDoorZ), not on the wall itself —
    // the wall's gap is the corridor mouth (see #buildCustomerCorridors).
    this.marketEntryDoor = this.#buildDoorRow(settings.supermarket.customerDoorZ, [settings.supermarket.marketX])[0];
    this.marketExitDoor = this.#buildDoorRow(settings.supermarket.customerDoorZ, [settings.supermarket.marketExitX])[0];

    // The restock truck's delivery door: a single gate off the FRONT wall, at
    // deliveryDoorX — corridor-relocated like the customer doors, to the far end
    // of its own corridor (deliveryDoorZ), keeping the automatic door clear of
    // the shelf aisles. The truck pulls up to its exterior road and stays at the
    // dock outside (see scene/TruckView.js).
    this.marketDeliveryDoor = this.#buildDoorRow(settings.supermarket.deliveryDoorZ, [settings.supermarket.deliveryDoorX])[0];

    this.#buildMarketCorridors();

    // The gas-station gate: a single door in the LEFT wall at gasStation.gateZ,
    // the player's walkway to the pump row. Same pillar/lintel shape as the
    // z-wall doors, rotated onto the x-wall; hidden (solid wall) until the
    // station's first lot is bought — toggled in update() like the market doors.
    this.gasGateDoor = this.#buildLeftDoor(settings.gasStation.gateZ);
  }

  /**
   * The market's walk/drive-through corridors: each relocated opening (customer
   * entry + exit on the back wall, the delivery gate on the front wall) extends
   * outward as a floor slab flanked by two side walls, running from the building
   * to the relocated door frame (customerDoorZ / deliveryDoorZ). Shown only once
   * the supermarket is open, together with the market door frames (see
   * update()). Lengths are the customerCorridorLength / deliveryCorridorLength
   * knobs in settings.supermarket.
   */
  #buildMarketCorridors() {
    const W = settings.world;
    const S = settings.supermarket;
    const g = W.gateHalf;
    const t = W.wallThickness;
    const h = W.wallHeight;

    const group = new THREE.Group();

    // One corridor from the building wall's slab centre (wallZ) out to the
    // relocated door plane (doorZ); works on either wall — the direction falls
    // out of the two z's.
    const corridor = (doorX, wallZ, doorZ) => {
      const dir = Math.sign(doorZ - wallZ);
      // Floor: the corridor interior, from the building wall out past the door
      // frame. Matches the lobby floor (colour + concrete grain) the corridors
      // spill out of, so they read as one space.
      const depth = Math.abs(doorZ) + t / 2 - W.halfZ;
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(g * 2, depth),
        makeFloorMaterial(settings.colors.lobby, g * 2, depth)
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(doorX, 0.012, dir * (W.halfZ + depth / 2));
      floor.receiveShadow = true;
      group.add(floor);

      // Side walls flanking the gap: from the building wall's OUTER face out to
      // the relocated frame's pillar near-face — butting both (starting at the
      // slab centre / running to the door plane would clip into the main wall
      // band and the pillars, z-fighting along their coplanar tops).
      const zStart = dir * (W.halfZ + t);
      const zEnd = doorZ - dir * (PILLAR_W / 2);
      for (const side of [-1, 1]) {
        const len = Math.abs(zEnd - zStart);
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(t, h, len),
          makeBrickWallMaterials(len, h, t, 'z')
        );
        wall.position.set(doorX + side * (g + t / 2), h / 2, (zStart + zEnd) / 2);
        wall.castShadow = true;
        wall.receiveShadow = true;
        group.add(wall);
      }
    };

    corridor(S.marketX, this.backWallZ, S.customerDoorZ);
    corridor(S.marketExitX, this.backWallZ, S.customerDoorZ);
    corridor(S.deliveryDoorX, this.frontWallZ, S.deliveryDoorZ);

    group.visible = false;
    this.group.add(group);
    this.marketCorridors = group;
  }

  /** A door on the LEFT wall (x = -halfX): pillars flank the gap along z. */
  #buildLeftDoor(gateZ) {
    const c = settings.colors;
    const W = settings.world;
    const h = W.wallHeight;
    const g = W.gateHalf;
    const x = -W.halfX - W.wallThickness / 2;

    const gateMat = new THREE.MeshStandardMaterial({ color: c.gate, flatShading: true });
    // Pillar tops sit flush with the wall top (y = h), like the lintel — nothing
    // pokes above the frame. The wall segments end at the pillars' outer faces
    // (see #layoutLeftWall), so pillar and wall butt instead of overlapping.
    const pillar = (z) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(PILLAR_W, h, PILLAR_W), gateMat);
      p.position.set(x, h / 2, z);
      p.castShadow = true;
      p.visible = false;
      this.group.add(p);
      return p;
    };
    // Lintel top sits flush with the wall top (y = h), never above it. It spans
    // exactly between the pillars' inner faces — butting them, not overlapping.
    const lintelH = 0.5;
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(PILLAR_W, lintelH, g * 2 - PILLAR_W), gateMat);
    lintel.position.set(x, h - lintelH / 2, gateZ);
    lintel.castShadow = true;
    lintel.visible = false;
    this.group.add(lintel);

    return { pillarL: pillar(gateZ - g), pillarR: pillar(gateZ + g), lintel };
  }

  #buildDoorRow(z, xs = settings.pit.positions.map((p) => p.x)) {
    const c = settings.colors;
    const W = settings.world;
    const h = W.wallHeight;
    const g = W.gateHalf;

    const gateMat = new THREE.MeshStandardMaterial({ color: c.gate, flatShading: true });
    // Pillar tops sit flush with the wall top (y = h), like the lintel — nothing
    // pokes above the frame. On-wall doors get their wall gap widened by
    // PILLAR_W / 2 per side (see #layoutSegmentedWall), so the segments butt the
    // pillars' outer faces instead of overlapping them.
    const pillar = (x) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(PILLAR_W, h, PILLAR_W), gateMat);
      p.position.set(x, h / 2, z);
      p.castShadow = true;
      p.visible = false;
      this.group.add(p);
      return p;
    };
    const lintel = (x) => {
      // Lintel top sits flush with the wall top (y = h), never above it. It
      // spans exactly between the pillars' inner faces — butting, not overlapping.
      const lintelH = 0.5;
      const l = new THREE.Mesh(new THREE.BoxGeometry(g * 2 - PILLAR_W, lintelH, PILLAR_W), gateMat);
      l.position.set(x, h - lintelH / 2, z);
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

    // Pit doors carry pillars ON the wall: their gap is widened by PILLAR_W / 2
    // per side so the segments butt the pillars' outer faces (no overlap, no
    // z-fighting tops). Market openings are bare corridor mouths — their gap
    // stays exactly gateHalf so the corridor side walls (inner faces at ±g)
    // continue the wall edge flush.
    const doors = state.pits
      .filter((p) => p.roomUnlocked)
      .map((p) => ({ x: settings.pit.positions[p.index].x, half: g + PILLAR_W / 2 }));
    if (state.supermarket.unlocked) doors.push(...marketDoorXs.map((x) => ({ x, half: g })));
    doors.sort((a, b) => a.x - b.x);

    const segs = [];
    let cursor = leftX;
    for (const d of doors) {
      const gapStart = d.x - d.half;
      if (gapStart > cursor) segs.push([cursor, gapStart]);
      cursor = Math.max(cursor, d.x + d.half);
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
      fitBrickSpan(mesh.material, a, b); // keep bricks world-sized + world-anchored while the segment rescales
    });
  }

  /** Place the left wall: solid until the gas station exists, then two spans
   * flanking the gate at gasStation.gateZ (the player's walkway to the pump row). */
  #layoutLeftWall(gasOpen) {
    const W = settings.world;
    const h = W.wallHeight;
    const g = W.gateHalf;
    const t = W.wallThickness;
    const gateZ = settings.gasStation.gateZ;
    const x = -W.halfX - W.wallThickness / 2;

    // Spans run to the front/back walls' OUTER faces (±(halfZ + t)) so both
    // left corners are filled flush; the gas gate's gap is widened by
    // PILLAR_W / 2 per side so the wall butts its pillars (see #buildLeftDoor).
    const spans = gasOpen
      ? [
          [-W.halfZ - t, gateZ - g - PILLAR_W / 2],
          [gateZ + g + PILLAR_W / 2, W.halfZ + t],
        ]
      : [[-W.halfZ - t, W.halfZ + t]];

    this.leftSegments.forEach((mesh, i) => {
      const span = spans[i];
      if (!span || span[1] - span[0] <= 0.001) {
        mesh.visible = false;
        return;
      }
      const [z0, z1] = span;
      mesh.visible = true;
      mesh.scale.z = Math.max(0.001, z1 - z0);
      mesh.position.set(x, h / 2, (z0 + z1) / 2);
      fitBrickSpan(mesh.material, z0, z1); // this wall runs along z; same refit as the x-walls
    });
  }
}
