import settings from '../config/settings.js';

const laneWidth = (positions, fallback = 4.5) =>
  positions.length > 1 ? Math.abs(positions[1].x - positions[0].x) : fallback;

function pushBox(boxes, xMin, xMax, z0, z1) {
  boxes.push({ x: (xMin + xMax) / 2, z: (z0 + z1) / 2, halfX: (xMax - xMin) / 2, halfZ: (z1 - z0) / 2 });
}

export function playerRoadBoxes(state) {
  const W = settings.world;
  const extent = W.road.extent;
  const boxes = [];

  const P = settings.pit.positions;
  const pitHalf = laneWidth(P) / 2;
  state.pits.forEach((pit, i) => {
    if (!pit.roomUnlocked) return;
    const x = P[i].x;
    pushBox(boxes, x - pitHalf, x + pitHalf, W.halfZ, W.halfZ + extent);
    pushBox(boxes, x - pitHalf, x + pitHalf, -(W.halfZ + extent), -W.halfZ);
  });

  if (state.supermarket && state.supermarket.unlocked) {
    const S = settings.supermarket;
    const dockFarZ = S.restockBoxPosition.z + S.truck.deliverOffset.z;
    const half = laneWidth(P) / 2; // the delivery slab reuses the pit lane width (Garage.#buildDeliveryRoad)
    const x = S.restockBoxPosition.x + S.truck.deliverOffset.x;
    pushBox(boxes, x - half, x + half, -(W.halfZ + extent), dockFarZ);
    pushBox(boxes, x + half, P[0].x - pitHalf, -(W.halfZ + extent), dockFarZ);
  }

  return boxes;
}

function laneBridgeZ(p) {
  return p.z + settings.unlockMarkers.hireOffset.z + settings.pitLane.bridge.zOffset;
}

export function laneBridgeCrossings() {
  return settings.pit.positions.map((p, index) => ({ kind: 'pit', index, x: p.x, z: laneBridgeZ(p) }));
}

let spineLayoutCache = null;

export function pumpSpineLayout() {
  if (spineLayoutCache) return spineLayoutCache;
  const G = settings.gasStation.positions;
  const L = settings.pitLane;
  const S = L.spine;
  const z = laneBridgeZ(G[0]);
  const junctions = G.map((p) => p.x + S.spurOffsetX);
  const last = G.length - 1;
  const past = S.spurWidth / 2 + S.endPad; // a piece boundary sits just past a junction
  const pieces = G.map((p, i) => ({
    index: i,
    xMax: i === 0 ? junctions[0] + past : junctions[i] - past,
    xMin: i === last ? p.x - L.halfWidth : junctions[i + 1] - past,
    spurs: i === 0 ? (last === 0 ? [0] : [0, 1]) : i < last ? [i + 1] : [],
  }));
  spineLayoutCache = { z, junctions, pieces };
  return spineLayoutCache;
}

function laneWallBoxes(x, z0, z1, bridgeZ) {
  const L = settings.pitLane;
  const ch = L.bridge.width / 2;
  const boxes = [];
  for (const [a, b] of [
    [z0, bridgeZ - ch],
    [bridgeZ + ch, z1],
  ]) {
    if (b - a <= 0.001) continue;
    boxes.push({ x, z: (a + b) / 2, halfX: L.halfWidth, halfZ: (b - a) / 2 });
  }
  return boxes;
}

export function pitLaneBoxes(i) {
  const W = settings.world;
  const L = settings.pitLane;
  const B = L.bridge;
  const p = settings.pit.positions[i];
  const bridgeZ = laneBridgeZ(p);
  const boxes = laneWallBoxes(p.x, -W.halfZ, W.halfZ, bridgeZ);

  const railInset = B.width / 2 - 0.05;
  for (const side of [-1, 1]) {
    const rampCentreX = p.x + side * (L.halfWidth + B.rampLength / 2);
    for (const s of [-1, 1]) {
      boxes.push({ x: rampCentreX, z: bridgeZ + s * railInset, halfX: B.rampLength / 2, halfZ: 0.05 });
    }
  }
  return boxes;
}

export function pitRampAvoid(i) {
  const L = settings.pitLane;
  const B = L.bridge;
  const p = settings.pit.positions[i];
  const bridgeZ = laneBridgeZ(p);
  const xMin = p.x + L.halfWidth;
  const xMax = p.x + L.halfWidth + B.rampLength;
  return { xMin, xMax, zMin: bridgeZ - B.width / 2, zMax: bridgeZ + B.width / 2 };
}

export function pumpLaneBoxes(i, neighbours = {}) {
  const { prevEquipped = true, nextEquipped = true } = neighbours;
  const W = settings.world;
  const L = settings.pitLane;
  const B = L.bridge;
  const S = L.spine;
  const p = settings.gasStation.positions[i];
  const last = i === settings.gasStation.positions.length - 1;
  const spine = pumpSpineLayout();
  const piece = spine.pieces[i];
  const boxes = laneWallBoxes(p.x, -(W.halfZ + W.road.extent), W.halfZ + W.road.extent, spine.z);

  const railInset = B.width / 2 - 0.05;
  const rail = (x0, x1, z) => {
    if (x1 - x0 > 0.01) boxes.push({ x: (x0 + x1) / 2, z, halfX: (x1 - x0) / 2, halfZ: 0.05 });
  };
  rail(piece.xMin, piece.xMax, spine.z - railInset);
  let a = piece.xMin;
  for (const jx of piece.spurs.map((j) => spine.junctions[j]).sort((q, w) => q - w)) {
    rail(a, jx - S.spurWidth / 2, spine.z + railInset);
    a = jx + S.spurWidth / 2;
  }
  rail(a, piece.xMax, spine.z + railInset);

  for (const j of piece.spurs) {
    const jx = spine.junctions[j];
    const zc = spine.z + B.width / 2 + S.spurLength / 2;
    for (const s of [-1, 1]) {
      boxes.push({ x: jx + s * (S.spurWidth / 2 - 0.05), z: zc, halfX: 0.05, halfZ: S.spurLength / 2 });
    }
  }

  const cap = (x) => boxes.push({ x, z: spine.z, halfX: 0.15, halfZ: B.width / 2 });
  if (i === 0 || !prevEquipped) cap(piece.xMax + 0.15);
  if (last || !nextEquipped) cap(piece.xMin - 0.15);
  return boxes;
}

export function laneBridgeElevationAt(state, x, z) {
  const L = settings.pitLane;
  const B = L.bridge;
  for (const c of laneBridgeCrossings()) {
    if (!state.pits[c.index].equipped) continue;
    if (Math.abs(z - c.z) > B.width / 2) continue;
    const dx = Math.abs(x - c.x);
    if (dx <= L.halfWidth) return B.height;
    const t = 1 - (dx - L.halfWidth) / B.rampLength;
    if (t > 0) return t * B.height;
  }
  const S = L.spine;
  const spine = pumpSpineLayout();
  for (const piece of spine.pieces) {
    if (!state.gasStation.pumps[piece.index].equipped) continue;
    if (Math.abs(z - spine.z) <= B.width / 2 && x >= piece.xMin && x <= piece.xMax) return B.height;
    for (const j of piece.spurs) {
      if (Math.abs(x - spine.junctions[j]) > S.spurWidth / 2) continue;
      const dz = z - (spine.z + B.width / 2);
      if (dz > 0 && dz < S.spurLength) return B.height * (1 - dz / S.spurLength);
    }
  }
  return 0;
}
