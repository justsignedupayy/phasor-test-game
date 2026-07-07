/**
 * roads.js — player-side road blocking + the raised lane bridges over the car
 * lanes. No Three.js.
 *
 * Vehicle roads — the garage entry/exit slabs (Garage.#buildExteriorRoads) and
 * the market's delivery road (Garage.#buildDeliveryRoad) — are solid to the
 * PLAYER only: NPCs are untouched (mechanics/attendants work ON the lanes, the
 * market NPCs' A* grid never extends past the building walls, and cars are not
 * movers). There are no flat pedestrian crossings over them: the player never
 * needs to cross the entry band (behind the back wall, unreachable), and the
 * delivery road is solid only past the walkable dock — the DOCK (front wall
 * out to the truck's stop) stays walkable so the restock box remains reachable.
 *
 * Every CAR LANE — each equipped pit's interior lane and each equipped pump's
 * full road — is instead fenced by invisible walls along its full depth,
 * crossed only by a small RAISED bridge near that pit's/pump's hire marker
 * (settings.pitLane, shared by both kinds; see pitLaneBoxes / pumpLaneBoxes /
 * laneBridgeCrossings / laneBridgeElevationAt). Cars are NOT movers: they
 * tween straight through underneath, completely unaffected. Outside the lane
 * strips, the gas station's asphalt is ordinary walkable ground — the pumps,
 * attendant work spots, break chairs and unlock markers all stand beside the
 * fenced lanes, and manual tap-fill works from the lane's edge (wall halfWidth
 * + player radius stays within gasStation.radius, exactly like a pit).
 */
import settings from '../config/settings.js';

/** Lane width of a road band = the spacing of its lane centres (mirrors how
 * Garage.js sizes its slabs). */
const laneWidth = (positions, fallback = 4.5) =>
  positions.length > 1 ? Math.abs(positions[1].x - positions[0].x) : fallback;

/** Push one solid road AABB spanning x ∈ [xMin, xMax], z ∈ [z0, z1]. */
function pushBox(boxes, xMin, xMax, z0, z1) {
  boxes.push({ x: (xMin + xMax) / 2, z: (z0 + z1) / 2, halfX: (xMax - xMin) / 2, halfZ: (z1 - z0) / 2 });
}

/**
 * Player-blocking road AABBs ({ x, z, halfX, halfZ }) for the current unlock
 * state — a slab only blocks once it exists in the world (a pit lane with its
 * land bought, the delivery road with the market open). Fed to pushOutOfRect
 * in simulation.updatePlayer, and ONLY there. The pump lanes are NOT here:
 * their asphalt is walkable, and the car strip itself is fenced by
 * pumpLaneBoxes (in core/collision.buildObstacleList) like a pit lane's.
 */
export function playerRoadBoxes(state) {
  const W = settings.world;
  const extent = W.road.extent;
  const boxes = [];

  // Pit lanes (unlock left→right with Expand Room): per open lane, both the
  // entry slab (behind the back wall) and the exit slab are fully solid — the
  // lane is crossed INSIDE the building, over its raised bridge.
  const P = settings.pit.positions;
  const pitHalf = laneWidth(P) / 2;
  state.pits.forEach((pit, i) => {
    if (!pit.roomUnlocked) return;
    const x = P[i].x;
    pushBox(boxes, x - pitHalf, x + pitHalf, W.halfZ, W.halfZ + extent);
    pushBox(boxes, x - pitHalf, x + pitHalf, -(W.halfZ + extent), -W.halfZ);
  });

  // Delivery road: solid only PAST the dock — the stretch from the front wall
  // to the truck's stop stays walkable (the restock box lives there), and the
  // player has no reason to cross beyond it.
  if (state.supermarket && state.supermarket.unlocked) {
    const S = settings.supermarket;
    const dockFarZ = S.restockBoxPosition.z + S.truck.deliverOffset.z;
    const half = laneWidth(P) / 2; // the delivery slab reuses the pit lane width (Garage.#buildDeliveryRoad)
    const x = S.restockBoxPosition.x + S.truck.deliverOffset.x;
    pushBox(boxes, x - half, x + half, -(W.halfZ + extent), dockFarZ);
  }

  return boxes;
}

/* ──────────────────── car-lane walls + raised bridges ─────────────────── */

/** z of a lane-bridge deck centre for the pit/pump at row position p: just
 * past its hire marker, on the far side from the pit/pump (hireOffset already
 * points down-lane toward the front; bridge.zOffset pushes a bit further). */
function laneBridgeZ(p) {
  return p.z + settings.unlockMarkers.hireOffset.z + settings.pitLane.bridge.zOffset;
}

/** The per-lane bridge crossings, STATIC: { kind, index, x, z } deck centres —
 * one per pit lane and one per pump lane (both rows share the same hireOffset,
 * so both bridges sit just past their hire marker). Each deck spans its lane
 * in x (pitLane.halfWidth each side, ramps beyond). */
export function laneBridgeCrossings() {
  const pits = settings.pit.positions.map((p, index) => ({ kind: 'pit', index, x: p.x, z: laneBridgeZ(p) }));
  const pumps = settings.gasStation.positions.map((p, index) => ({
    kind: 'pump',
    index,
    x: p.x,
    z: laneBridgeZ(p),
  }));
  return [...pits, ...pumps];
}

/** A lane's invisible edge walls: one strip along z ∈ [z0, z1] at lane centre
 * x whose long faces are the walls at both lane edges — filled solid so the
 * bridge gap can't be used to wander up the lane at grade — split around the
 * bridge corridor, so crossing the lane is possible ONLY over the bridge. */
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

/**
 * Pit i's car-lane walls as mover-blocking AABBs, spanning the lane's FULL
 * interior depth (back wall to front wall). Emitted with the other per-pit
 * props in core/collision.buildObstacleList once the pit is equipped (cars
 * only drive an equipped pit's lane; before that it is open floor, and the
 * equip/expand markers standing on it stay reachable).
 */
export function pitLaneBoxes(i) {
  const W = settings.world;
  const p = settings.pit.positions[i];
  return laneWallBoxes(p.x, -W.halfZ, W.halfZ, laneBridgeZ(p));
}

/**
 * Pump i's car-lane walls, the gas-station mirror of pitLaneBoxes: the same
 * strip geometry, spanning the pump road's FULL depth (its slab runs the whole
 * road extent both ways — GasStationView.#buildPump). Emitted by
 * buildObstacleList once the pump is equipped, on the same reasoning.
 */
export function pumpLaneBoxes(i) {
  const W = settings.world;
  const p = settings.gasStation.positions[i];
  return laneWallBoxes(p.x, -(W.halfZ + W.road.extent), W.halfZ + W.road.extent, laneBridgeZ(p));
}

/**
 * Visual deck height for the player at (x, z): bridge.height on a deck,
 * tapering linearly down each end ramp, 0 elsewhere. Gated on the crossing's
 * pit/pump being equipped, so walls, meshes and elevation appear together —
 * before that the lane is open ground and the player walks it at grade.
 * Purely visual: core positions stay 2D and the crossing itself is the carved
 * wall gap.
 */
export function laneBridgeElevationAt(state, x, z) {
  const L = settings.pitLane;
  const B = L.bridge;
  for (const c of laneBridgeCrossings()) {
    const equipped = c.kind === 'pit' ? state.pits[c.index].equipped : state.gasStation.pumps[c.index].equipped;
    if (!equipped) continue;
    if (Math.abs(z - c.z) > B.width / 2) continue;
    const dx = Math.abs(x - c.x);
    const t = dx <= L.halfWidth ? 1 : 1 - (dx - L.halfWidth) / B.rampLength;
    if (t > 0) return Math.min(1, t) * B.height;
  }
  return 0;
}
