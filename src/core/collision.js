/**
 * collision.js — axis-aligned box push-out for the supermarket props. No Three.js.
 *
 * Since NPCs now navigate static obstacles with A* (core/pathfinding.js), this is
 * no longer their navigator. It survives as a LIGHT safety net only:
 *   • the PLAYER's static collision (simulation.js calls it after clampToBounds —
 *     the player isn't grid-routed, so it still needs push-out off shelves/checkout);
 *   • NPC agent-agent overlap is handled separately in supermarket.js.
 * It mirrors simulation.repelFromRect: push the circle to the nearest point where it
 * just clears each obstacle box. Obstacle boxes are the same shelves/freezers/checkout
 * (with the same collision halves/offsets) the pathfinding grid inflates.
 */
import settings from '../config/settings.js';

/**
 * Resolve a circle (centre `pos` {x,z}, radius `r`) against one axis-aligned
 * rectangle `b` = { x, z, halfX, halfZ }, pushing the centre out to where they just
 * touch (outward normal when outside, shallowest side when the centre is inside).
 */
function pushOutOfRect(pos, r, b) {
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
 * Every solid box in the supermarket, as { x, z, halfX, halfZ }: each shelf/freezer
 * (collision halves by model type, nudged by its per-type offset) plus the checkout.
 * Built fresh each call — a handful of boxes, a pure function of the tunables.
 */
function marketBoxes() {
  const M = settings.supermarket;
  const boxes = [];
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
  return boxes;
}

/**
 * Push a mover (circle of radius `r` at `pos` {x,z}) out of every supermarket
 * obstacle it overlaps. No-op until the shop is unlocked (the props don't exist
 * before then). Used by the player after its clampToBounds; NPCs use A* instead.
 */
export function resolveSupermarketCollisions(state, pos, r) {
  if (!state.supermarket || !state.supermarket.unlocked) return;
  for (const b of marketBoxes()) pushOutOfRect(pos, r, b);
}
