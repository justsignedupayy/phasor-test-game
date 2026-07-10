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
 * crossed only by a RAISED bridge deck near that pit's/pump's hire marker
 * (settings.pitLane, shared by both kinds; see pitLaneBoxes / pumpLaneBoxes /
 * laneBridgeCrossings / laneBridgeElevationAt). Each PIT gets its own small
 * bridge (ramp up, deck, ramp down). The PUMP row instead gets a single
 * elevated SPINE: one flat walkway at constant bridge height running the whole
 * row along the crossing corridor (never dipping between pumps), crossed onto
 * and off via a short perpendicular SPUR at each pump — a steep stair-like
 * descent off the spine's pump side down to that pump's ground strip (see
 * pumpSpineLayout). The spine's and every spur's railings are SOLID, so the
 * spur mouths are the only ways on or off; both outer spine ends are closed
 * (cap boxes — nothing lies past the LAST pump, and the garage end is entered
 * via pump 0's spur). The structure grows a piece per equipped pump, and a
 * piece's open grow-end carries a TEMPORARY cap until the neighbouring piece
 * exists (see pumpLaneBoxes' neighbour flags). Cars are NOT movers: they tween
 * straight through underneath, completely unaffected. Outside the lane strips,
 * the gas station's asphalt is ordinary walkable ground — the pumps, attendant
 * work spots, break spots and unlock markers all stand beside the fenced
 * lanes, and manual tap-fill works from the lane's edge (wall halfWidth +
 * player radius stays within gasStation.radius, exactly like a pit).
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
    // Seal the open ground STRIP between the delivery road's right edge and
    // pit A's road — with both road slabs solid only along their own x bands,
    // this strip had no z floor, so a player stepping out the delivery gate
    // could walk down it forever. Same z span as the delivery road's solid
    // part, so the dock (front wall → truck stop) stays walkable and the
    // delivery-gate crossing is untouched.
    pushBox(boxes, x + half, P[0].x - pitHalf, -(W.halfZ + extent), dockFarZ);
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

/** The per-PIT bridge crossings, STATIC: { kind, index, x, z } deck centres,
 * one per pit lane, each deck spanning its lane in x (pitLane.halfWidth each
 * side, ramps beyond). The pump row's crossing is the spine instead — see
 * pumpSpineLayout (same corridor z, from the shared hireOffset + zOffset). */
export function laneBridgeCrossings() {
  return settings.pit.positions.map((p, index) => ({ kind: 'pit', index, x: p.x, z: laneBridgeZ(p) }));
}

let spineLayoutCache = null;

/**
 * The pump spine walkway's STATIC geometry (cached — settings never change at
 * runtime). One straight elevated deck along the row's shared crossing
 * corridor (every pump sits at the same z, so laneBridgeZ is one line):
 *   z          the spine's centre z (= the corridor the lane walls are gapped at)
 *   junctions  per-pump spur centre x (pump.x + spine.spurOffsetX — the open
 *              ground on the pump's garage side); spur j descends from the
 *              spine's pump (+z) side down to pump j's ground strip
 *   pieces     one deck stretch per pump, abutting exactly so the visible spine
 *              is seamless: { index, xMin, xMax, spurs }. Piece i covers its own
 *              lane crossing plus the NEXT pump's junction, and `spurs` lists
 *              the junction indexes it carries — piece i brings spur i+1 (the
 *              descent needed once lane i is fenced), and piece 0 also brings
 *              spur 0 (the walkway's entry). The LAST piece carries none: its
 *              far end is the row's closed boundary end. xMax of piece 0 runs
 *              endPad past spur 0's junction (the spine's capped +x end); xMin
 *              of the last piece is its lane's far edge (the capped -x end).
 */
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
  const L = settings.pitLane;
  const B = L.bridge;
  const p = settings.pit.positions[i];
  const bridgeZ = laneBridgeZ(p);
  const boxes = laneWallBoxes(p.x, -W.halfZ, W.halfZ, bridgeZ);

  // The bridge's end-ramp railings are solid down both slope edges (matching
  // the rail meshes in scene/Bridges.#addRamp and mirroring the pump spurs'
  // rails), so a ramp is entered only through its mouth (the ground-level far
  // end) or from the deck — never sideways at partial height. Each rail abuts
  // the lane walls' carved corridor corner exactly, closing the barrier from
  // wall to ramp tip.
  const railInset = B.width / 2 - 0.05;
  for (const side of [-1, 1]) {
    const rampCentreX = p.x + side * (L.halfWidth + B.rampLength / 2);
    for (const s of [-1, 1]) {
      boxes.push({ x: rampCentreX, z: bridgeZ + s * railInset, halfX: B.rampLength / 2, halfZ: 0.05 });
    }
  }
  return boxes;
}

/**
 * Pit i's worker-side (+x) bridge ramp footprint as an AABB { xMin, xMax, zMin,
 * zMax }. The ramp's sloped top is a WALKABLE pedestrian crossing — the player
 * walks up it to cross the lane — so it is deliberately NOT a solid collision box
 * (pitLaneBoxes only fences its two edge RAILS): a solid footprint would wall the
 * player off the bridge AND trap the pit's own worker, whose work spot sits in
 * the pocket between the lane wall and the ramp tip. This box is a NAVIGATION
 * hint used only by that worker's steering (core/simulation.moveMechanic) so it
 * routes AROUND its own ramp instead of cutting through the sloped section. Only
 * the +x ramp is described — every mechanic work/shelf/break spot is on the +x
 * side of the lane, so the worker never nears the -x ramp.
 */
export function pitRampAvoid(i) {
  const L = settings.pitLane;
  const B = L.bridge;
  const p = settings.pit.positions[i];
  const bridgeZ = laneBridgeZ(p);
  const xMin = p.x + L.halfWidth;
  const xMax = p.x + L.halfWidth + B.rampLength;
  return { xMin, xMax, zMin: bridgeZ - B.width / 2, zMax: bridgeZ + B.width / 2 };
}

/**
 * Pump i's car-lane walls, the gas-station mirror of pitLaneBoxes: the same
 * strip geometry, spanning the pump road's FULL depth (its slab runs the whole
 * road extent both ways — GasStationView.#buildPump). Emitted by
 * buildObstacleList once the pump is equipped, on the same reasoning.
 */
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

  // The spine's railings are SOLID along this piece's whole length (matching
  // the rail meshes in scene/Bridges: inset 0.05 from the corridor edge, 0.1
  // thick): they keep the player on the deck AND keep the ground-level player
  // from wandering into the strip under it. The far (-z) rail is unbroken; the
  // pump-side (+z) rail is gapped only at this piece's spur junctions — the
  // sole ways on/off the spine.
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

  // Each spur's railings are solid down both slope edges, so a spur is entered
  // only through its mouth (the ground-level +z end) or from the spine.
  for (const j of piece.spurs) {
    const jx = spine.junctions[j];
    const zc = spine.z + B.width / 2 + S.spurLength / 2;
    for (const s of [-1, 1]) {
      boxes.push({ x: jx + s * (S.spurWidth / 2 - 0.05), z: zc, halfX: 0.05, halfZ: S.spurLength / 2 });
    }
  }

  // End caps seal a deck end's full corridor width so the player neither walks
  // off a bridge-height cliff nor enters the elevated strip at grade. The
  // spine's two OUTER ends are always capped (past the LAST pump nothing lies
  // beyond the row; the +x garage end is entered via spur 0, not head-on). A
  // piece's INNER end is capped only while the neighbouring piece is missing —
  // a temporary frontier rail that vanishes when the spine grows across it.
  const cap = (x) => boxes.push({ x, z: spine.z, halfX: 0.15, halfZ: B.width / 2 });
  if (i === 0 || !prevEquipped) cap(piece.xMax + 0.15);
  if (last || !nextEquipped) cap(piece.xMin - 0.15);
  return boxes;
}

/**
 * Visual deck height for the player at (x, z). Pit bridges: bridge.height on
 * a deck, tapering linearly down each end ramp. Pump spine: bridge.height
 * anywhere on an equipped piece's flat deck (the spine never changes height
 * along its length), tapering down a spur's descent toward its mouth.
 * 0 elsewhere. Gated per pit/pump equip, so walls, meshes and elevation
 * appear together — before that the lane is open ground and the player walks
 * it at grade. Purely visual: core positions stay 2D and the crossings
 * themselves are the carved wall gaps.
 */
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
