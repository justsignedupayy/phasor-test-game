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
    if (state.hasCashier) state.cash += car.payout;
    else pit.pendingCash += car.payout;
    pit.car = null; // updateYard refills from the queue
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

  // Per-pit routing: a free equipped pit pulls the front of its OWN queue.
  for (const pit of state.pits) {
    if (pit.equipped && !pit.car && pit.queue.length > 0) {
      pit.car = pit.queue.shift();
    }
  }
}

/**
 * Generate one car and route it to the pit whose index matches its tier's index
 * in settings.carTiers (pit 0 = rusty … pit 4 = luxury). The car is discarded if
 * that pit doesn't exist, isn't equipped, or its queue is already full.
 */
function spawnToMatchingPit(state) {
  const car = spawnCar(state);
  const pitIndex = settings.carTiers.findIndex((t) => t.name === car.tier);
  const pit = state.pits[pitIndex];
  if (!pit || !pit.equipped || pit.queue.length >= settings.spawn.maxQueuePerPit) {
    return; // no matching slot — discard the car
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
}

/** In bay territory, the right edge is fenced to whatever land is owned; the lane is always open. */
function clampToBounds(state, pos) {
  const limX = settings.world.halfX - settings.player.radius;
  const limZ = settings.world.halfZ - settings.player.radius;
  const rightLim = (pos.z > BAY_ZONE_Z ? ownedRightX(state) : settings.world.halfX) - settings.player.radius;
  pos.x = Math.max(-limX, Math.min(rightLim, pos.x));
  pos.z = Math.max(-limZ, Math.min(limZ, pos.z));
}
