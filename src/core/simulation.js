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
import { workerSpeed, requiredTicks } from './upgrades.js';

export function tick(state, dt) {
  updatePlayer(state, dt);
  updateYard(state, dt);
  for (const pit of state.pits) updatePit(state, pit, dt);
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

/** Shared completion path for both manual taps and the worker. */
function applyRepair(state, pit, ticks) {
  const car = pit.car;
  const required = requiredTicks(car, pit);
  car.ticksDone = Math.min(required, car.ticksDone + ticks);
  if (car.ticksDone >= required) {
    car.fixed = true;
    state.cash += car.payout;
    pit.car = null; // updateYard refills from the queue
  }
}

function updateYard(state, dt) {
  state.spawnTimer += dt;
  if (state.spawnTimer >= settings.spawn.interval && state.carQueue.length < settings.spawn.maxQueue) {
    state.carQueue.push(spawnCar());
    state.spawnTimer = 0;
  }

  // Assign the front queued car to the lowest-index free equipped pit.
  for (const pit of state.pits) {
    if (state.carQueue.length === 0) break;
    if (pit.equipped && !pit.car) {
      pit.car = state.carQueue.shift();
    }
  }
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
    clampToBounds(player.position);

    player.rotation = Math.atan2(dirX, dirZ);
    player.moving = true;
  } else {
    player.moving = false;
  }
}

function clampToBounds(pos) {
  const limX = settings.world.halfX - settings.player.radius;
  const limZ = settings.world.halfZ - settings.player.radius;
  pos.x = Math.max(-limX, Math.min(limX, pos.x));
  pos.z = Math.max(-limZ, Math.min(limZ, pos.z));
}
