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
import { resolveSupermarketCollisions, resolveGarageCollisions } from './collision.js';
import { tickBreak, incrementJobCount } from './breaks.js';

export function tick(state, dt) {
  // collectedThisTick is a one-tick render signal (the scene pops "+$" / flies
  // bills when it's > 0); clear it before any collection can set it this tick.
  for (const pit of state.pits) pit.collectedThisTick = 0;
  updatePlayer(state, dt);
  updateStorage(state);
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
  if (!pit.mechanic) pit.mechanic = createMechanic(pit.index); // lazily on first tick after hire

  // Advance the break clock, then the mechanic's movement FSM (its break-walk and,
  // with auto-restock owned, its box-fetch trip). Both run regardless of a car.
  tickBreak(pit.break, dt); // advance a running break; may auto-end it this frame
  updateMechanic(state, pit, dt);

  // On break: the worker sits at its chair and does no auto-repair. Cars still
  // queue/pull into the pit as usual (they just wait), identical to an idle pit.
  if (pit.break.onBreak) return;

  const car = pit.car;
  if (!car || car.fixed) return;

  // Don't start repairing until the mechanic has physically reached its work spot
  // beside the pit — it may still be walking back from a break or a restock trip.
  // Gate on arrival (within arriveEpsilon of the work position), not just on hire.
  const m = pit.mechanic;
  const M = settings.mechanic;
  const pos = settings.pit.positions[pit.index];
  const work = { x: pos.x + M.offsetX, z: pos.z + M.offsetZ };
  if (Math.hypot(m.position.x - work.x, m.position.z - work.z) > settings.supermarket.arriveEpsilon) return;

  // ...and not until the car itself has finished driving in and settled in the pit
  // (settleRemaining counts the drive-in tween down — see updateYard).
  if (car.settleRemaining > 0) return;

  const mult = pit.hurryTimer > 0 ? settings.hurry.multiplier : 1;
  applyRepair(state, pit, workerSpeed(pit) * mult * dt);
}

// --- the pit mechanic: a core-owned NPC, mirroring the market worker ----------

/** A freshly hired mechanic, standing at its work spot beside the pit, facing the car. */
function createMechanic(pitIndex) {
  const pos = settings.pit.positions[pitIndex];
  const M = settings.mechanic;
  const x = pos.x + M.offsetX;
  const z = pos.z + M.offsetZ;
  return {
    position: { x, z },
    rotation: Math.atan2(pos.x - x, pos.z - z) + M.facingOffset,
    moving: false,
    carrying: false, // holding a restock box (the toWork leg)
    state: 'idle', // 'idle' | 'restocking' | 'onBreak'
    phase: null, // restock leg in progress: 'toShelf' | 'toWork'
  };
}

/**
 * Advance one pit mechanic each tick. Mirrors the market worker's restock FSM (go to
 * source → pick up → carry back → deposit), but for the garage: when auto-restock is
 * owned and the pit has run dry (tiresRemaining 0), the mechanic walks to ITS OWN
 * shelf, picks up a box, carries it back to the pit, and refills the tire stack.
 * A pending restock leg finishes first; a break wins over starting a new one (it
 * walks to its chair and sits). Without the upgrade it just holds its work spot — the
 * pit stays dry until the player restocks (unchanged behaviour).
 */
function updateMechanic(state, pit, dt) {
  const m = pit.mechanic;
  if (!m) return;
  const M = settings.mechanic;
  const S = settings.storage;
  const pos = settings.pit.positions[pit.index];
  const work = { x: pos.x + M.offsetX, z: pos.z + M.offsetZ };
  const workFacing = Math.atan2(pos.x - work.x, pos.z - work.z) + M.facingOffset;
  const speed = settings.breaks.mechanicWalkSpeed;

  // Restock leg in progress: finish it before anything else (mirrors the market worker).
  if (m.phase === 'toShelf') {
    const shelf = { x: pos.x + S.shelfOffset.x, z: pos.z + S.shelfOffset.z };
    const arrived = moveMechanic(state, pit, m, shelf, speed, dt);
    m.moving = !arrived;
    if (arrived) {
      m.carrying = true; // picked up a box
      m.phase = 'toWork';
    }
    return;
  }
  if (m.phase === 'toWork') {
    const arrived = moveMechanic(state, pit, m, work, speed, dt);
    m.moving = !arrived;
    m.carrying = true;
    if (arrived) {
      pit.tiresRemaining = S.maxTiresPerPit; // delivered box refills the stack
      m.carrying = false;
      m.phase = null;
      m.state = 'idle';
      m.rotation = workFacing;
    }
    return;
  }

  // On break: walk to this pit's chair and sit (no restock/repair meanwhile).
  if (pit.break.onBreak) {
    const chair = settings.breaks.chairPositions[pit.index];
    const arrived = moveMechanic(state, pit, m, chair, speed, dt);
    m.moving = !arrived;
    m.state = 'onBreak';
    m.carrying = false;
    if (arrived) m.rotation = settings.breaks.chairFacing;
    return;
  }

  // Idle decision: start an auto-restock trip when owned and the pit has run dry;
  // otherwise hold (return to) the work spot, facing the car.
  if (state.autoRestock && pit.tiresRemaining === 0) {
    m.state = 'restocking';
    m.phase = 'toShelf';
    m.carrying = false;
    return;
  }
  const arrived = moveMechanic(state, pit, m, work, speed, dt);
  m.moving = !arrived;
  m.carrying = false;
  m.state = 'idle';
  if (arrived) m.rotation = workFacing;
}

/**
 * Straight-line step toward `target` at `speed`, then push the mechanic out of every
 * garage prop except its OWN pit's (so it can stand on its own shelf / work spot /
 * chair) — the same push-out the player gets. Returns true once it reaches the target.
 */
function moveMechanic(state, pit, m, target, speed, dt) {
  const dx = target.x - m.position.x;
  const dz = target.z - m.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= 0.05) {
    m.position.x = target.x;
    m.position.z = target.z;
    return true;
  }
  const step = Math.min(dist, speed * dt);
  m.position.x += (dx / dist) * step;
  m.position.z += (dz / dist) * step;
  m.rotation = Math.atan2(dx, dz);
  resolveGarageCollisions(state, m.position, settings.player.radius, { excludePitIndex: pit.index });
  return false;
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
    // A finished repair counts a job toward this worker's break (only a hired
    // worker takes breaks — a manual-tap completion with no mechanic doesn't).
    if (pit.hasMechanic) incrementJobCount(pit.break);
  }
}

/**
 * Manual tire logistics. The player ferries boxes from a pit's shelf to its worker
 * to refill that pit's tire stack. The pickup only applies while auto-restock ISN'T
 * owned — once it is, each pit's mechanic fetches boxes itself (see updateMechanic),
 * so manual pickup is redundant. Proximity flags (playerNearShelf / playerPresent)
 * are written by the scene each frame and only read here.
 */
function updateStorage(state) {
  const S = settings.storage;
  const player = state.player;

  // Shelf stock is infinite + decorative, so a pickup never depletes shelfBoxes.
  // Hands must be free: no pickup while already hauling either kind of box (the
  // market restock box is the other carryable — see main.js handleMarketTap).
  for (const pit of state.pits) {
    if (!pit.equipped) continue;
    if (!state.autoRestock && !player.carryingBox && !player.carryingRestockBox && pit.playerNearShelf && pit.shelfBoxes > 0) {
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
      // Hold repair until the car finishes driving in and settles at the pit spot.
      // Mirrors the scene's drive-in tween length (settings.pit.driveDuration).
      pit.car.settleRemaining = settings.pit.driveDuration;
    }
  }

  // Count down each settling car's drive-in timer; it's only repairable (by the
  // worker) once it reaches its pit spot (settleRemaining hits 0 — see updatePit).
  for (const pit of state.pits) {
    if (pit.car && pit.car.settleRemaining > 0) {
      pit.car.settleRemaining = Math.max(0, pit.car.settleRemaining - dt);
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

  // Solid props: push the player circle out of every supermarket obstacle
  // (shelves/freezers/checkout). The player never targets an obstacle centre, so
  // nothing is exempted for it.
  resolveSupermarketCollisions(state, player.position, settings.player.radius);
  // ...and out of every garage prop (per-pit shelves, tire stacks, break chairs)
  // plus the room's right (fence) wall at ownedRightX — the one expanding wall the
  // clampToBounds above leaves open in the front lane (z <= BAY_ZONE_Z).
  resolveGarageCollisions(state, player.position, settings.player.radius, {
    roomWallX: ownedRightX(state),
  });
}

/**
 * In bay territory, the right edge is fenced to whatever land is owned; the lane
 * is always open. The left + back walls are solid: the player stays inside the
 * building. The front wall is solid too, EXCEPT the supermarket delivery-door gap
 * (deliveryDoorX): once the market is open the player may step out through it to
 * reach the restock pile just outside, the same gate the market worker uses
 * (see clampFallbackToWalls). The gap also stays open while the player is already
 * outside (pos.z past the wall) so a sideways move toward the pile isn't shoved back in.
 */
function clampToBounds(state, pos) {
  const W = settings.world;
  const M = settings.supermarket;
  const r = settings.player.radius;
  const limX = W.halfX - r;
  const limZ = W.halfZ - r;
  const rightLim = (pos.z > BAY_ZONE_Z ? ownedRightX(state) : W.halfX) - r;
  const leftLim = -limX;

  pos.x = Math.max(leftLim, Math.min(rightLim, pos.x));

  // Back wall is always solid; the front wall opens ONLY within gateHalf of the
  // delivery-door x. The "already past the wall" allowance is gated against the true
  // wall plane (-halfZ), a full radius beyond the clamp line (-limZ): the player can
  // only get past the clamp line while standing in the gate, so off-gate the wall is
  // completely solid; once fully outside it moves freely to/from the restock pile.
  const atDeliveryGate =
    state.supermarket && state.supermarket.unlocked && Math.abs(pos.x - M.deliveryDoorX) <= W.gateHalf;
  const crossingFront = atDeliveryGate || pos.z < -W.halfZ;
  pos.z = Math.min(limZ, pos.z);
  if (!crossingFront) pos.z = Math.max(-limZ, pos.z);
}
