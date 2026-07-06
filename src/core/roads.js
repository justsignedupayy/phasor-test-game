/**
 * roads.js — player-side road blocking + the pedestrian bridges over them.
 * No Three.js.
 *
 * Vehicle roads — the garage entry/exit slabs (Garage.#buildExteriorRoads),
 * the market's delivery road (Garage.#buildDeliveryRoad) and the gas station's
 * pump lanes (GasStationView.#buildPump) — are solid to the PLAYER only:
 * NPCs are untouched (mechanics/attendants work ON the lanes, the market NPCs'
 * A* grid never extends past the building walls, and cars are not movers).
 *
 * Each road group gets one raised pedestrian bridge (settings.bridges): its
 * deck corridor is CARVED out of that road's collision boxes, so the bridge is
 * exactly where the band can be crossed. The scene renders the structures
 * (scene/Bridges.js) and lifts the player model by bridgeElevationAt while it
 * is inside a corridor — core positions stay 2D, the elevation is purely
 * visual, and cars/trucks drive underneath unaffected.
 *
 * Two deliberate at-grade exemptions keep the game playable:
 *   • the delivery DOCK (front wall out to the truck's stop) stays walkable so
 *     the restock box remains reachable — the road is solid only beyond it;
 *   • the gas FORECOURT (pumpZ ± gasForecourtHalfDepth) stays walkable — the
 *     pumps, attendant work spots, break chairs and unlock markers all stand
 *     on that asphalt, and manual tap-fill needs the player beside the car.
 */
import settings from '../config/settings.js';

/** Lane width of a road band = the spacing of its lane centres (mirrors how
 * Garage.js / GasStationView.js size their slabs). */
const laneWidth = (positions, fallback = 4.5) =>
  positions.length > 1 ? Math.abs(positions[1].x - positions[0].x) : fallback;

/** Full-span x extents of the garage road band (all 5 pit lanes). */
function pitBandFull() {
  const P = settings.pit.positions;
  const half = laneWidth(P) / 2;
  return { xMin: P[0].x - half, xMax: P[P.length - 1].x + half };
}

/** Full-span x extents of the gas road band (all 5 pump lanes, growing left). */
function gasBandFull() {
  const G = settings.gasStation.positions;
  const half = laneWidth(G) / 2;
  return { xMin: G[G.length - 1].x - half, xMax: G[0].x + half };
}

/** The delivery road's x extents (one pit-width lane on the truck's path). */
function deliveryBand() {
  const S = settings.supermarket;
  const half = laneWidth(settings.pit.positions) / 2; // the delivery slab reuses the pit lane width (Garage.#buildDeliveryRoad)
  const x = S.restockBoxPosition.x + S.truck.deliverOffset.x;
  return { xMin: x - half, xMax: x + half };
}

/**
 * The four bridge crossings, STATIC (decks span the FULL road band even while
 * some lanes are still locked, so collision corridors, elevation and meshes
 * never move): each { name, z, xMin, xMax } deck runs along x at a fixed z,
 * crossing its road's lanes; a rampLength ramp descends past each end.
 */
export function bridgeCrossings() {
  const B = settings.bridges;
  const pit = pitBandFull();
  return [
    { name: 'garageEntry', z: B.garageEntryZ, ...pit },
    { name: 'garageExit', z: B.garageExitZ, ...pit },
    { name: 'delivery', z: B.deliveryZ, ...deliveryBand() },
    { name: 'gas', z: B.gasZ, ...gasBandFull() },
  ];
}

/** Push a road box spanning z ∈ [z0, z1], split around a bridge corridor
 * (bridgeZ ± corridorHalf) when it passes through — the carve IS the crossing. */
function pushSplit(boxes, xMin, xMax, z0, z1, bridgeZ, corridorHalf) {
  const spans = [
    [z0, Math.min(z1, bridgeZ - corridorHalf)],
    [Math.max(z0, bridgeZ + corridorHalf), z1],
  ];
  for (const [a, b] of spans) {
    if (b - a <= 0.001) continue;
    boxes.push({ x: (xMin + xMax) / 2, z: (a + b) / 2, halfX: (xMax - xMin) / 2, halfZ: (b - a) / 2 });
  }
}

/**
 * Player-blocking road AABBs ({ x, z, halfX, halfZ }) for the current unlock
 * state — a road only blocks once its slab exists in the world (a pit/pump
 * lane with its lot bought, the delivery road with the market open). Fed to
 * pushOutOfRect in simulation.updatePlayer, and ONLY there.
 */
export function playerRoadBoxes(state) {
  const B = settings.bridges;
  const W = settings.world;
  const ch = B.deckWidth / 2;
  const extent = W.road.extent;
  const boxes = [];

  // Garage entry + exit bands. Lanes unlock left→right with Expand Room, so
  // the open band runs from lane 0's left edge to the last open lane's right.
  const P = settings.pit.positions;
  const pitHalf = laneWidth(P) / 2;
  let lastPit = -1;
  state.pits.forEach((p, i) => {
    if (p.roomUnlocked) lastPit = i;
  });
  if (lastPit >= 0) {
    const xMin = P[0].x - pitHalf;
    const xMax = P[lastPit].x + pitHalf;
    pushSplit(boxes, xMin, xMax, W.halfZ, W.halfZ + extent, B.garageEntryZ, ch);
    pushSplit(boxes, xMin, xMax, -(W.halfZ + extent), -W.halfZ, B.garageExitZ, ch);
  }

  // Delivery road: solid only PAST the dock — the stretch from the front wall
  // to the truck's stop stays walkable (the restock box lives there).
  if (state.supermarket && state.supermarket.unlocked) {
    const S = settings.supermarket;
    const dockFarZ = S.restockBoxPosition.z + S.truck.deliverOffset.z;
    const d = deliveryBand();
    pushSplit(boxes, d.xMin, d.xMax, -(W.halfZ + extent), dockFarZ, B.deliveryZ, ch);
  }

  // Gas lanes (unlock rightmost-first, growing left): solid outside the
  // forecourt service band around the pump row.
  const G = settings.gasStation;
  const gasHalf = laneWidth(G.positions) / 2;
  let lastPump = -1;
  state.gasStation.pumps.forEach((p, i) => {
    if (p.roomUnlocked) lastPump = i;
  });
  if (lastPump >= 0) {
    const xMin = G.positions[lastPump].x - gasHalf;
    const xMax = G.positions[0].x + gasHalf;
    const pumpZ = G.positions[0].z;
    // South of the forecourt — carries the gas bridge…
    pushSplit(boxes, xMin, xMax, -(W.halfZ + extent), pumpZ - B.gasForecourtHalfDepth, B.gasZ, ch);
    // …and north of it (the queue side). No bridge: clampToBounds already
    // caps the player at z <= halfZ - r, so nobody can ever stand there.
    pushSplit(boxes, xMin, xMax, pumpZ + B.gasForecourtHalfDepth, W.halfZ + extent, Infinity, ch);
  }

  return boxes;
}

/**
 * Visual deck height for the player at (x, z): deckHeight on a deck, tapering
 * linearly down each end ramp, 0 elsewhere. Static on purpose — every bridge
 * zone is unreachable until its road system exists (closed gates/walls), so no
 * state gating is needed and the scene can call this with position alone.
 */
export function bridgeElevationAt(x, z) {
  const B = settings.bridges;
  for (const c of bridgeCrossings()) {
    if (Math.abs(z - c.z) > B.deckWidth / 2) continue;
    let t;
    if (x >= c.xMin && x <= c.xMax) t = 1;
    else if (x < c.xMin) t = (x - (c.xMin - B.rampLength)) / B.rampLength;
    else t = (c.xMax + B.rampLength - x) / B.rampLength;
    if (t > 0) return Math.min(1, t) * B.deckHeight;
  }
  return 0;
}
