/**
 * collision.js — axis-aligned box push-out for the supermarket props. No Three.js.
 *
 * Since NPCs now navigate static obstacles with A* (core/pathfinding.js), this is
 * no longer their navigator. It survives as a LIGHT safety net only:
 *   • the PLAYER's static collision (simulation.js calls it after clampToBounds —
 *     the player isn't grid-routed, so it still needs push-out off shelves/checkout);
 *   • NPC agent-agent overlap is handled separately in supermarket.js.
 * pushOutOfRect pushes a circle to the nearest point where it just clears an obstacle
 * box. buildObstacleList
 * is the single source of obstacle geometry, shared with the pathfinding grid so the two
 * never drift; the boxes are the same shelves/freezers/checkout/garage props it inflates.
 */
import settings from '../config/settings.js';

/**
 * Resolve a circle (centre `pos` {x,z}, radius `r`) against one axis-aligned
 * rectangle `b` = { x, z, halfX, halfZ }, pushing the centre out to where they just
 * touch (outward normal when outside, shallowest side when the centre is inside).
 */
export function pushOutOfRect(pos, r, b) {
  const dx = pos.x - b.x;
  const dz = pos.z - b.z;
  const cx = Math.max(-b.halfX, Math.min(b.halfX, dx));
  const cz = Math.max(-b.halfZ, Math.min(b.halfZ, dz));
  const nx = dx - cx;
  const nz = dz - cz;
  const distSq = nx * nx + nz * nz;

  if (distSq > r * r) return; // gap wider than the radius — no overlap

  if (distSq > 1e-12) {
    const dist = Math.sqrt(distSq);
    const push = r - dist;
    pos.x += (nx / dist) * push;
    pos.z += (nz / dist) * push;
  } else {
    const penX = b.halfX - Math.abs(dx);
    const penZ = b.halfZ - Math.abs(dz);
    if (penX < penZ) {
      pos.x = b.x + (dx < 0 ? -1 : 1) * (b.halfX + r);
    } else {
      pos.z = b.z + (dz < 0 ? -1 : 1) * (b.halfZ + r);
    }
  }
}

/**
 * The single source of static-obstacle AABB geometry, shared by the player/mechanic
 * push-out (this file) and the NPC A* grid (pathfinding.js) so every box's position +
 * half-extent is defined in exactly ONE place. Returns boxes as { x, z, halfX, halfZ }.
 *
 * opts selects which obstacles to include so each caller gets exactly the set it built
 * before:
 *   market   (default true)  supermarket shelves/freezers (collision halves by model
 *                            type, nudged by its per-type offset) + the checkout
 *   garage   (default true)  pit shelves + tire stacks + break chairs
 *   allPits  (default false) garage props for EVERY pit, state-free (the A* grid bakes
 *                            them all in once — harmless, market NPCs never reach the
 *                            bay row). When false, only the props that actually exist
 *                            in-world right now: an equipped pit's shelf, a tire stack
 *                            with stock (it stops blocking when the pit runs dry,
 *                            matching the scene), and a hired pit's break chair.
 *   excludePitIndex          skip one pit's garage props — the mechanic ignores its OWN
 *                            pit so the per-frame push never shoves it off its work spot
 *                            (right beside its tire stack) or out of its own chair.
 *   walls    (default [])    extra wall boxes ({ x, z, halfX, halfZ }) to PREPEND — the
 *                            room's right (fence) wall (= roomWallBox(ownedRightX)) for
 *                            the player, the moving fence wall for the grid.
 *
 * Walls are emitted first, then market, then garage — the exact order the old
 * buildGarageBoxes / marketBoxes produced, so the order-dependent sequential push-out
 * is byte-for-byte unchanged.
 */
export function buildObstacleList(state, settings, opts = {}) {
  const { market = true, garage = true, allPits = false, excludePitIndex, walls = [] } = opts;
  const M = settings.supermarket;
  const S = settings.storage;
  const B = settings.breaks;
  const boxes = [];

  for (const w of walls) boxes.push(w);

  if (market) {
    for (const shelf of M.shelves) {
      const freezer = shelf.model === 'freezer';
      const half = freezer ? M.freezerCollisionHalf : M.shelfCollisionHalf;
      const off = freezer ? M.freezerCollisionOffset : M.shelfCollisionOffset;
      boxes.push({ x: shelf.x + off.x, z: shelf.z + off.z, halfX: half.x, halfZ: half.z });
    }
    boxes.push({
      x: M.checkoutPosition.x,
      z: M.checkoutPosition.z,
      halfX: M.checkoutCollisionHalf.x,
      halfZ: M.checkoutCollisionHalf.z,
    });
  }

  if (garage) {
    for (let i = 0; i < settings.pit.positions.length; i++) {
      if (i === excludePitIndex) continue;
      const pit = allPits ? null : state.pits[i];
      const p = settings.pit.positions[i];
      if (allPits || pit.equipped) {
        boxes.push({
          x: p.x + S.shelfOffset.x,
          z: p.z + S.shelfOffset.z,
          halfX: S.garageShelfCollisionHalf.x,
          halfZ: S.garageShelfCollisionHalf.z,
        });
        if (allPits || pit.tiresRemaining > 0) {
          boxes.push({
            x: p.x + S.tireOffset.x,
            z: p.z + S.tireOffset.z,
            halfX: S.tireCollisionHalf.x,
            halfZ: S.tireCollisionHalf.z,
          });
        }
      }
      if (allPits || pit.hasMechanic) {
        const c = B.chairPositions[i];
        boxes.push({ x: c.x, z: c.z, halfX: B.chairCollisionHalf.x, halfZ: B.chairCollisionHalf.z });
      }
    }
  }

  return boxes;
}

/**
 * The room's right (fence) wall box at world x `roomWallX` (= ownedRightX(state)),
 * matching the wall mesh in Garage.js (centred a half-thickness outside roomWallX,
 * full room depth). Used both for player push-out and to re-block the A* grid when
 * a room unlock moves it (see core/pathfinding.rebuildGrid, called from upgrades.js).
 */
export function roomWallBox(roomWallX) {
  const W = settings.world;
  const wall = settings.pit.pitWallCollisionHalf;
  return { x: roomWallX + W.wallThickness / 2, z: 0, halfX: wall.x, halfZ: wall.z };
}

/** Push a mover (circle radius `r` at `pos`) out of every garage prop (see buildObstacleList). */
export function resolveGarageCollisions(state, pos, r, opts = {}) {
  const walls = opts.roomWallX != null ? [roomWallBox(opts.roomWallX)] : [];
  const boxes = buildObstacleList(state, settings, {
    market: false,
    excludePitIndex: opts.excludePitIndex,
    walls,
  });
  for (const b of boxes) pushOutOfRect(pos, r, b);
}

/** The cash-register's solid box, as { x, z, halfX, halfZ }, at its own world spot. */
function cashRegisterBox() {
  const M = settings.supermarket;
  return {
    x: M.cashRegisterPosition.x,
    z: M.cashRegisterPosition.z,
    halfX: M.cashRegisterCollisionHalf.x,
    halfZ: M.cashRegisterCollisionHalf.z,
  };
}

/**
 * Push a mover (circle of radius `r` at `pos` {x,z}) out of every supermarket
 * obstacle it overlaps. The cash register blocks once the cashier is hired
 * (state.hasCashier); the shelves/checkout block once the shop is unlocked.
 * Used by the player after its clampToBounds; NPCs use A* instead.
 */
export function resolveSupermarketCollisions(state, pos, r) {
  if (state.hasCashier) pushOutOfRect(pos, r, cashRegisterBox());
  if (!state.supermarket || !state.supermarket.unlocked) return;
  for (const b of buildObstacleList(state, settings, { garage: false })) pushOutOfRect(pos, r, b);
}
