/**
 * roads.js — player-side road blocking + the flat pedestrian crossings over them.
 * No Three.js.
 *
 * Vehicle roads — the garage entry/exit slabs (Garage.#buildExteriorRoads),
 * the market's delivery road (Garage.#buildDeliveryRoad) and the gas station's
 * pump lanes (GasStationView.#buildPump) — are solid to the PLAYER only:
 * NPCs are untouched (mechanics/attendants work ON the lanes, the market NPCs'
 * A* grid never extends past the building walls, and cars are not movers).
 *
 * Crossings are SMALL and PER-LANE (settings.bridges): each pit's EXIT lane and
 * each pump's lane gets one crosswalk exactly one lane wide, at the z where the
 * player actually needs to cross (garageExitZ / gasZ). The crosswalk corridor
 * is CARVED out of that lane's collision box, so the lane stays blocked
 * everywhere except the crossing. Decks are FLUSH with the walkable ground —
 * painted zebra stripes (scene/Bridges.js), no elevation, cars simply drive
 * over the paint. Roads the player never needs to cross get NO crossing: the
 * entry band (behind the back wall, unreachable) and the delivery road (solid
 * only past the walkable dock).
 *
 * Two deliberate at-grade exemptions keep the game playable:
 *   • the delivery DOCK (front wall out to the truck's stop) stays walkable so
 *     the restock box remains reachable — the road is solid only beyond it;
 *   • the gas FORECOURT (pumpZ ± gasForecourtHalfDepth) stays walkable — the
 *     pumps, attendant work spots, break chairs and unlock markers all stand
 *     on that asphalt, and manual tap-fill needs the player beside the car.
 *
 * INSIDE the building, each equipped pit's car lane is fenced by invisible
 * walls along its full depth, crossed only by a small RAISED bridge near that
 * pit's hire marker (settings.pitLane; see pitLaneBoxes / laneBridgeCrossings /
 * laneBridgeElevationAt at the bottom of this file).
 */
import settings from '../config/settings.js';

/** Lane width of a road band = the spacing of its lane centres (mirrors how
 * Garage.js / GasStationView.js size their slabs). */
const laneWidth = (positions, fallback = 4.5) =>
  positions.length > 1 ? Math.abs(positions[1].x - positions[0].x) : fallback;

/**
 * The per-lane crossings, STATIC (each spans exactly its own lane's width, so
 * corridors and meshes never move): one { kind, index, z, xMin, xMax } per pit
 * exit lane and per pump lane. Adjacent lanes' crossings sit at the same z and
 * meet edge-to-edge, so an unlocked row reads as one continuous crosswalk —
 * but a crossing only exists (collides/shows) with its own lane's road.
 */
export function bridgeCrossings() {
  const B = settings.bridges;
  const out = [];
  const P = settings.pit.positions;
  const pitHalf = laneWidth(P) / 2;
  P.forEach((p, index) =>
    out.push({ kind: 'pit', index, z: B.garageExitZ, xMin: p.x - pitHalf, xMax: p.x + pitHalf })
  );
  const G = settings.gasStation.positions;
  const gasHalf = laneWidth(G) / 2;
  G.forEach((p, index) =>
    out.push({ kind: 'pump', index, z: B.gasZ, xMin: p.x - gasHalf, xMax: p.x + gasHalf })
  );
  return out;
}

/** Push a road box spanning z ∈ [z0, z1], split around a crosswalk corridor
 * (bridgeZ ± corridorHalf) when it passes through — the carve IS the crossing.
 * Pass bridgeZ = Infinity for a solid, crossing-less span. */
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
 * state — a lane only blocks once its slab exists in the world (a pit/pump
 * lane with its lot bought, the delivery road with the market open). Fed to
 * pushOutOfRect in simulation.updatePlayer, and ONLY there.
 */
export function playerRoadBoxes(state) {
  const B = settings.bridges;
  const W = settings.world;
  const ch = B.deckWidth / 2;
  const extent = W.road.extent;
  const boxes = [];

  // Pit lanes (unlock left→right with Expand Room): per open lane, the entry
  // slab is fully solid (behind the back wall — unreachable, no crossing) and
  // the exit slab is split around that pit's own crosswalk.
  const P = settings.pit.positions;
  const pitHalf = laneWidth(P) / 2;
  state.pits.forEach((pit, i) => {
    if (!pit.roomUnlocked) return;
    const x = P[i].x;
    pushSplit(boxes, x - pitHalf, x + pitHalf, W.halfZ, W.halfZ + extent, Infinity, ch);
    pushSplit(boxes, x - pitHalf, x + pitHalf, -(W.halfZ + extent), -W.halfZ, B.garageExitZ, ch);
  });

  // Delivery road: solid only PAST the dock, and NO crossing — the stretch
  // from the front wall to the truck's stop stays walkable (the restock box
  // lives there), and the player has no reason to cross beyond it.
  if (state.supermarket && state.supermarket.unlocked) {
    const S = settings.supermarket;
    const dockFarZ = S.restockBoxPosition.z + S.truck.deliverOffset.z;
    const half = laneWidth(P) / 2; // the delivery slab reuses the pit lane width (Garage.#buildDeliveryRoad)
    const x = S.restockBoxPosition.x + S.truck.deliverOffset.x;
    pushSplit(boxes, x - half, x + half, -(W.halfZ + extent), dockFarZ, Infinity, ch);
  }

  // Pump lanes (unlock rightmost-first, growing left): per open lane, the slab
  // south of the forecourt is split around that pump's own crosswalk; the
  // queue side north of it is solid — no crossing, clampToBounds already caps
  // the player at z <= halfZ - r, so nobody can ever stand there.
  const G = settings.gasStation;
  const gasHalf = laneWidth(G.positions) / 2;
  const pumpZ = G.positions[0].z;
  state.gasStation.pumps.forEach((pump, i) => {
    if (!pump.roomUnlocked) return;
    const x = G.positions[i].x;
    pushSplit(boxes, x - gasHalf, x + gasHalf, -(W.halfZ + extent), pumpZ - B.gasForecourtHalfDepth, B.gasZ, ch);
    pushSplit(boxes, x - gasHalf, x + gasHalf, pumpZ + B.gasForecourtHalfDepth, W.halfZ + extent, Infinity, ch);
  });

  return boxes;
}

/* ──────────────────── interior pit-lane walls + bridges ─────────────────── */

/** z of pit i's lane-bridge deck centre: just past the pit's hire marker, on
 * the far side from the pit (hireOffset already points down-lane toward the
 * front; bridge.zOffset pushes a bit further). */
function laneBridgeZ(i) {
  const p = settings.pit.positions[i];
  return p.z + settings.unlockMarkers.hireOffset.z + settings.pitLane.bridge.zOffset;
}

/** The per-pit lane-bridge crossings, STATIC: { index, x, z } deck centres.
 * Each deck spans its lane in x (pitLane.halfWidth each side, ramps beyond). */
export function laneBridgeCrossings() {
  return settings.pit.positions.map((p, index) => ({ index, x: p.x, z: laneBridgeZ(index) }));
}

/**
 * Pit i's invisible car-lane walls as mover-blocking AABBs: one strip along
 * the lane's FULL interior depth (back wall to front wall) whose long faces
 * are the walls at both lane edges — filled solid so the bridge gap can't be
 * used to wander up the lane at grade — split around the bridge corridor, so
 * crossing the lane is possible ONLY over the bridge. Emitted with the other
 * per-pit props in core/collision.buildObstacleList once the pit is equipped
 * (cars only drive an equipped pit's lane; before that it is open floor, and
 * the equip/expand markers standing on it stay reachable).
 */
export function pitLaneBoxes(i) {
  const L = settings.pitLane;
  const W = settings.world;
  const x = settings.pit.positions[i].x;
  const bz = laneBridgeZ(i);
  const ch = L.bridge.width / 2;
  const boxes = [];
  for (const [a, b] of [
    [-W.halfZ, bz - ch],
    [bz + ch, W.halfZ],
  ]) {
    if (b - a <= 0.001) continue;
    boxes.push({ x, z: (a + b) / 2, halfX: L.halfWidth, halfZ: (b - a) / 2 });
  }
  return boxes;
}

/**
 * Visual deck height for the player at (x, z): bridge.height on a deck,
 * tapering linearly down each end ramp, 0 elsewhere. Gated on the pit being
 * equipped, so walls, meshes and elevation appear together — before that the
 * lane is open floor and the player walks it at grade. Purely visual: core
 * positions stay 2D and the crossing itself is the carved wall gap.
 */
export function laneBridgeElevationAt(state, x, z) {
  const L = settings.pitLane;
  const B = L.bridge;
  for (const c of laneBridgeCrossings()) {
    if (!state.pits[c.index].equipped) continue;
    if (Math.abs(z - c.z) > B.width / 2) continue;
    const dx = Math.abs(x - c.x);
    const t = dx <= L.halfWidth ? 1 : 1 - (dx - L.halfWidth) / B.rampLength;
    if (t > 0) return Math.min(1, t) * B.height;
  }
  return 0;
}
