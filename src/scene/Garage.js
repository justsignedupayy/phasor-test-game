import * as THREE from 'three';
import settings from '../config/settings.js';
import { ownedRightX } from '../core/upgrades.js';
import { fitBrickSpan, makeAsphaltMaterial, makeBrickWallMaterials, makeFloorMaterial } from './groundTextures.js';

const PILLAR_W = 0.6;

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
    const target = ownedRightX(state);
    this.rightWallX =
      this.rightWallX === null ? target : this.rightWallX + (target - this.rightWallX) * Math.min(1, 6 * dt);

    this.#layoutRightWall(this.rightWallX);
    const marketDoors = [settings.supermarket.marketX, settings.supermarket.marketExitX];
    this.#layoutSegmentedWall(this.backSegments, this.backWallZ, this.rightWallX, state, marketDoors);
    this.#layoutSegmentedWall(this.frontSegments, this.frontWallZ, this.rightWallX, state, [
      settings.supermarket.deliveryDoorX,
    ]);
    const gasOpen = state.gasStation.pumps[0].roomUnlocked;
    this.#layoutLeftWall(gasOpen);

    const marketOpen = state.supermarket.unlocked;

    for (const d of [...this.backDoors, ...this.frontDoors]) {
      const open = state.pits[d.index].roomUnlocked;
      d.pillarL.visible = open;
      d.pillarR.visible = open;
      d.lintel.visible = open;
    }

    for (const d of [this.marketEntryDoor, this.marketExitDoor, this.marketDeliveryDoor]) {
      d.pillarL.visible = marketOpen;
      d.pillarR.visible = marketOpen;
      d.lintel.visible = marketOpen;
    }
    this.marketCorridors.visible = marketOpen;
    this.marketFloorGrid.visible = marketOpen;
    this.deliveryRoad.visible = marketOpen;

    this.gasGateDoor.pillarL.visible = gasOpen;
    this.gasGateDoor.pillarR.visible = gasOpen;
    this.gasGateDoor.lintel.visible = gasOpen;
    for (const r of this.roadSections) {
      r.group.visible = state.pits[r.index].roomUnlocked;
    }

    for (const m of this.laneMarkings) {
      m.group.visible = state.pits[m.index].roomUnlocked;
    }
    for (const d of this.pitDividers) {
      d.mesh.visible = state.pits[d.a].roomUnlocked && state.pits[d.b].roomUnlocked;
    }

    this.#clipFloorPatch(this.lobbyPatch);
    this.#clipFloorPatch(this.bayPatch);
  }

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
      makeFloorMaterial(c.floor, floorW, floorD)
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

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
    this.lobbyPatch = { mesh: lobby, leftX: -W.halfX, baseW: lobbyW, maxRightX: lobbyRightX };

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

  #buildMarketFloorGrid(lobbyRightX, floorD) {
    const W = settings.world;
    const tile = settings.supermarket.floorTileSize;
    const lineMat = new THREE.MeshBasicMaterial({ color: settings.colors.marketTileLine });
    const group = new THREE.Group();
    const leftX = -W.halfX;
    const width = lobbyRightX - leftX;

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

  #buildExteriorRoads() {
    const W = settings.world;
    const P = settings.pit;
    const positions = P.positions;

    const laneWidth = positions.length > 1 ? Math.abs(positions[1].x - positions[0].x) : 4.5;

    const R = W.road;
    const roadMat = makeAsphaltMaterial(laneWidth, R.extent);

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

    this.roadSections = positions.map((pos, index) => {
      const group = new THREE.Group();
      addRoad(group, pos.x, entry);
      addRoad(group, pos.x, exit);
      group.visible = false;
      this.group.add(group);
      return { index, group };
    });
  }

  #buildDeliveryRoad() {
    const c = settings.colors;
    const W = settings.world;
    const R = W.road;
    const S = settings.supermarket;
    const P = settings.pit;

    const positions = P.positions;
    const laneWidth = positions.length > 1 ? Math.abs(positions[1].x - positions[0].x) : 4.5;

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

  #buildLaneMarkings(floorD) {
    const c = settings.colors;
    const W = settings.world;
    const R = W.road;
    const P = settings.pit;
    const stripeMat = new THREE.MeshBasicMaterial({ color: c.laneStripe });
    const laneHalf = 1.6; // half-width of the painted lane, inside the 4.2-wide pit footprint

    const dashLen = R.dashLength;
    const step = dashLen + R.dashGap; // dash + gap

    const slabs = [
      [W.halfZ, W.halfZ + R.extent], // entry road, behind the back wall
      [-(W.halfZ + R.extent), -W.halfZ], // exit road, in front of the front wall
    ];
    const overPit = (z) =>
      P.positions.some((pos) => Math.abs(z - pos.z) < P.spotDepth / 2 + dashLen / 2);

    this.laneMarkings = P.positions.map((pos, index) => {
      const group = new THREE.Group();

      for (const side of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.12, floorD), stripeMat);
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(pos.x + side * laneHalf, 0.013, 0);
        group.add(edge);
      }

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
    const depthZ = W.halfZ * 2 + 2 * t;

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

    this.leftSegments = this.#buildLeftWallSegments(box);

    this.rightWall = box(t, depthZ, depthZ, 'z');
    this.group.add(this.rightWall);

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
    this.backDoors = this.#buildDoorRow(this.backWallZ);
    this.frontDoors = this.#buildDoorRow(this.frontWallZ);

    this.marketEntryDoor = this.#buildDoorRow(settings.supermarket.customerDoorZ, [settings.supermarket.marketX])[0];
    this.marketExitDoor = this.#buildDoorRow(settings.supermarket.customerDoorZ, [settings.supermarket.marketExitX])[0];

    this.marketDeliveryDoor = this.#buildDoorRow(settings.supermarket.deliveryDoorZ, [settings.supermarket.deliveryDoorX])[0];

    this.#buildMarketCorridors();

    this.gasGateDoor = this.#buildLeftDoor(settings.gasStation.gateZ);
  }

  #buildMarketCorridors() {
    const W = settings.world;
    const S = settings.supermarket;
    const g = W.gateHalf;
    const t = W.wallThickness;
    const h = W.wallHeight;

    const group = new THREE.Group();

    const corridor = (doorX, wallZ, doorZ) => {
      const dir = Math.sign(doorZ - wallZ);
      const depth = Math.abs(doorZ) + t / 2 - W.halfZ;
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(g * 2, depth),
        makeFloorMaterial(settings.colors.lobby, g * 2, depth)
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(doorX, 0.012, dir * (W.halfZ + depth / 2));
      floor.receiveShadow = true;
      group.add(floor);

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

  #buildLeftDoor(gateZ) {
    const c = settings.colors;
    const W = settings.world;
    const h = W.wallHeight;
    const g = W.gateHalf;
    const x = -W.halfX - W.wallThickness / 2;

    const gateMat = new THREE.MeshStandardMaterial({ color: c.gate, flatShading: true });
    const pillar = (z) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(PILLAR_W, h, PILLAR_W), gateMat);
      p.position.set(x, h / 2, z);
      p.castShadow = true;
      p.visible = false;
      this.group.add(p);
      return p;
    };
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
    const pillar = (x) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(PILLAR_W, h, PILLAR_W), gateMat);
      p.position.set(x, h / 2, z);
      p.castShadow = true;
      p.visible = false;
      this.group.add(p);
      return p;
    };
    const lintel = (x) => {
      const lintelH = 0.5;
      const l = new THREE.Mesh(new THREE.BoxGeometry(g * 2 - PILLAR_W, lintelH, PILLAR_W), gateMat);
      l.position.set(x, h - lintelH / 2, z);
      l.castShadow = true;
      l.visible = false;
      this.group.add(l);
      return l;
    };

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

  #layoutSegmentedWall(segments, wallZ, rightX, state, marketDoorXs) {
    const W = settings.world;
    const g = W.gateHalf;
    const h = W.wallHeight;
    const leftX = -W.halfX;

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

  #layoutLeftWall(gasOpen) {
    const W = settings.world;
    const h = W.wallHeight;
    const g = W.gateHalf;
    const t = W.wallThickness;
    const gateZ = settings.gasStation.gateZ;
    const x = -W.halfX - W.wallThickness / 2;

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
