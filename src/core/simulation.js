/**
 * simulation.js — all game-logic mutation lives here. No Three.js.
 *
 *   tick(state, dt)              advance the world: movement, spawning, queue→pits,
 *                                and each hired worker's automatic repair.
 *   tapRepair(state, pitIndex)   manual repair tap on one pit (adds tapTicks).
 *   hurry(state, pitIndex)       remote boost: temporarily speeds that pit's worker.
 */
import settings from '../config/settings.js';
import { spawnCar } from './Car.js';
import { workerSpeed, requiredTicks, ownedRightX, BAY_ZONE_Z } from './upgrades.js';
import { updateReputationTimer } from './reputation.js';

export function tick(state, dt) {
  // collectedThisTick is a one-tick render signal (the scene pops "+$" / flies
  // bills when it's > 0); clear it before any collection can set it this tick.
  for (const pit of state.pits) pit.collectedThisTick = 0;
  updatePlayer(state, dt);
  updateStorage(state, dt);
  updateYard(state, dt);
  for (const pit of state.pits) updatePit(state, pit, dt);
  // Collect after every pit has run, so pay a worker produces THIS tick is
  // banked the same tick when the player is standing there.
  for (const pit of state.pits) collectPending(state, pit);
  updateReputationTimer(state, dt);
}

/**
 * Manual repair on one pit. Allowed if the pit is equipped and either the player
 * is standing there or a worker is hired. Adds tapTicks of progress.
 */
export function tapRepair(state, pitIndex) {
  const pit = state.pits[pitIndex];
  if (!pit || !pit.equipped) return;
  if (!pit.playerPresent && !pit.hasMechanic) return;
  const car = pit.car;
  if (!car || car.fixed) return;
  applyRepair(state, pit, settings.repair.tapTicks);
}

/** Remote hurry: only meaningful with a worker; refreshes that pit's boost window. */
export function hurry(state, pitIndex) {
  const pit = state.pits[pitIndex];
  if (!pit || !pit.hasMechanic) return;
  pit.hurryTimer = settings.hurry.duration;
}

function updatePit(state, pit, dt) {
  if (pit.hurryTimer > 0) pit.hurryTimer = Math.max(0, pit.hurryTimer - dt);
  if (!pit.hasMechanic) return;

  const car = pit.car;
  if (!car || car.fixed) return;

  const mult = pit.hurryTimer > 0 ? settings.hurry.multiplier : 1;
  applyRepair(state, pit, workerSpeed(pit) * mult * dt);
}

/**
 * Shared completion path for both manual taps and the worker. The payout routes
 * by cashier: with a cashier hired it lands in spendable cash immediately;
 * otherwise it parks at the pit (pit.pendingCash) for the player to collect on
 * proximity. Either way the car leaves so the pit can take the next one.
 */
function applyRepair(state, pit, ticks) {
  const car = pit.car;
  const required = requiredTicks(car, pit);
  car.ticksDone = Math.min(required, car.ticksDone + ticks);
  if (car.ticksDone >= required) {
    car.fixed = true;
    pit.tiresRemaining = Math.max(0, pit.tiresRemaining - 1); // each repair burns a tire
    if (state.hasCashier) state.cash += car.payout;
    else pit.pendingCash += car.payout;
    pit.car = null; // updateYard refills from the queue (only while tires remain)
  }
}

/**
 * Tire logistics. The player ferries boxes from a pit's shelf to its worker to
 * refill that pit's tire stack; the Conveyor upgrade automates the same delivery
 * for every pit. Proximity flags (playerNearShelf / playerPresent) are written
 * by the scene each frame and only read here, matching the existing pattern.
 */
function updateStorage(state, dt) {
  const S = settings.storage;
  const player = state.player;

  // Conveyor: every interval, restock any pit that has run fully dry (tires at
  // 0) straight from its shelf. A pit with tires left is left alone. Shelf stock
  // is infinite + decorative, so this never depletes shelfBoxes.
  if (state.hasConveyor) {
    state.conveyorTimer += dt;
    if (state.conveyorTimer >= S.conveyorInterval) {
      state.conveyorTimer = 0;
      for (const pit of state.pits) {
        if (pit.equipped && pit.shelfBoxes > 0 && pit.tiresRemaining === 0) {
          pit.tiresRemaining = S.maxTiresPerPit; // one box = one full stack
        }
      }
    }
  }

  // Manual hauling: grab a box at a shelf, then drop it at that pit's worker.
  // Shelf stock is infinite + decorative, so a pickup never depletes shelfBoxes.
  for (const pit of state.pits) {
    if (!pit.equipped) continue;
    if (!player.carryingBox && pit.playerNearShelf && pit.shelfBoxes > 0) {
      player.carryingBox = true;
      player.carryingBoxPitIndex = pit.index;
    } else if (player.carryingBox && player.carryingBoxPitIndex === pit.index && pit.playerPresent) {
      player.carryingBox = false;
      player.carryingBoxPitIndex = null;
      pit.tiresRemaining = S.maxTiresPerPit; // delivered box refills the stack
    }
  }
}

/**
 * Bank a pit's waiting pay. Triggered by proximity (scene writes playerPresent,
 * core only reads it), same pattern as manual repair. A cashier collects from
 * anywhere; otherwise the player must be standing at the pit.
 */
function collectPending(state, pit) {
  if (pit.pendingCash <= 0) return;
  if (!state.hasCashier && !pit.playerPresent) return;
  state.cash += pit.pendingCash;
  pit.collectedThisTick = pit.pendingCash; // render signal for the "+$" popup
  pit.pendingCash = 0;
}

function updateYard(state, dt) {
  state.spawnTimer += dt;
  if (state.spawnTimer >= settings.spawn.interval) {
    // Generate one car each interval and route it to the pit matching its tier.
    // The car is discarded if that pit can't take it; the timer always resets.
    spawnToMatchingPit(state);
    state.spawnTimer = 0;
  }

  // Per-pit routing: a free equipped pit with tires pulls the front of its OWN
  // queue. A pit out of tires holds its line until it's refilled.
  for (const pit of state.pits) {
    if (pit.equipped && pit.tiresRemaining > 0 && !pit.car && pit.queue.length > 0) {
      pit.car = pit.queue.shift();
    }
  }
}

/**
 * Generate one car and route it to the pit whose index matches its tier's index
 * in settings.carTiers (pit 0 = rusty … pit 4 = luxury). The car is discarded if
 * that pit doesn't exist, isn't equipped, is out of tires, or its queue is full.
 */
function spawnToMatchingPit(state) {
  const car = spawnCar(state);
  const pitIndex = settings.carTiers.findIndex((t) => t.name === car.tier);
  const pit = state.pits[pitIndex];
  if (!pit || !pit.equipped || pit.tiresRemaining <= 0 || pit.queue.length >= settings.spawn.maxQueuePerPit) {
    return; // no matching slot (locked, out of tires, or full) — discard the car
  }
  pit.queue.push(car);
}

function updatePlayer(state, dt) {
  const { player, input } = state;
  const mag = Math.hypot(input.x, input.z);

  if (mag > 1e-4) {
    const m = Math.min(mag, 1); // analog speed, clamped
    const dirX = input.x / mag;
    const dirZ = input.z / mag;

    player.position.x += dirX * settings.player.speed * m * dt;
    player.position.z += dirZ * settings.player.speed * m * dt;
    clampToBounds(state, player.position);

    player.rotation = Math.atan2(dirX, dirZ);
    player.moving = true;
  } else {
    player.moving = false;
  }

  // Solid props: push the player circle out of any conveyor belt it overlaps.
  // The scene writes each equipped conveyor's world rectangle to pit.conveyorBounds.
  repelFromConveyors(state, player.position);
}

/** Push the player's circular radius out of every pit's conveyor rectangle. */
function repelFromConveyors(state, pos) {
  const r = settings.player.radius;
  for (const pit of state.pits) {
    if (pit.conveyorBounds) repelFromRect(pos, r, pit.conveyorBounds);
  }
}

/**
 * Resolve a circle (center `pos`, radius `r`) against an axis-aligned rectangle
 * `b` = { x, z, halfX, halfZ }: if they overlap, move the center to the nearest
 * point where they just touch. Mirrors how clampToBounds keeps the player a full
 * radius clear of a flat edge, but for a free-standing box (push out by corner/
 * edge normal when outside the rect, or out the shallowest side when inside it).
 */
function repelFromRect(pos, r, b) {
  const dx = pos.x - b.x;
  const dz = pos.z - b.z;
  // Closest point on the rectangle to the circle center (clamped offset).
  const cx = Math.max(-b.halfX, Math.min(b.halfX, dx));
  const cz = Math.max(-b.halfZ, Math.min(b.halfZ, dz));
  const nx = dx - cx;
  const nz = dz - cz;
  const distSq = nx * nx + nz * nz;

  if (distSq > r * r) return; // gap wider than the radius — no overlap

  if (distSq > 1e-12) {
    // Center is outside the rectangle: push along the outward normal to distance r.
    const dist = Math.sqrt(distSq);
    const push = r - dist;
    pos.x += (nx / dist) * push;
    pos.z += (nz / dist) * push;
  } else {
    // Center is inside the rectangle: eject out the nearest side (plus radius).
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
 * In bay territory, the right edge is fenced to whatever land is owned; the lane
 * is always open. The left edge is solid too, except through the supermarket's
 * restock door (once unlocked) — there the player may step out to the exterior
 * restock pile. This is separate from the customer doors (back/front walls,
 * see Garage.js's marketEntryDoor/marketExitDoor) — only the player uses this
 * one, to fetch boxes, never customers.
 */
function clampToBounds(state, pos) {
  const W = settings.world;
  const r = settings.player.radius;
  const limX = W.halfX - r;
  const limZ = W.halfZ - r;
  let rightLim = (pos.z > BAY_ZONE_Z ? ownedRightX(state) : W.halfX) - r;

  let leftLim = -limX;
  const M = settings.supermarket;
  const throughRestockDoor =
    state.supermarket.unlocked && Math.abs(pos.z - M.restockDoorZ) <= W.gateHalf - r;
  // Once unlocked, the player can step OUT through the restock door's z-gap to
  // the exterior pile (which sits north of the door, not dead-centre on it),
  // roam the exterior strip, and walk back in. The rest of the left wall stays
  // solid, so crossing it — out OR back — is only ever possible within the
  // door's z-band. Without this, leaving the band snapped the player back
  // inside before they could ever reach the pile.
  const outside = state.supermarket.unlocked && pos.x < -W.halfX;
  if (throughRestockDoor || outside) leftLim = M.exteriorLimitX + r;
  if (outside && !throughRestockDoor) rightLim = -W.halfX - r; // solid wall blocks re-entry off-door

  pos.x = Math.max(leftLim, Math.min(rightLim, pos.x));
  pos.z = Math.max(-limZ, Math.min(limZ, pos.z));
}
