/**
 * simulation.js — all game-logic mutation lives here. No Three.js.
 *
 *   tick(state, dt)    advance the world: movement, spawning, queue→pit, and the
 *                      mechanic's automatic repair (once hired).
 *   tapRepair(state)   manual repair tap (pre-mechanic loop: needs the player at
 *                      the pit and a car present).
 *   hurry(state)       remote boost: temporarily speeds the mechanic up.
 */
import settings from '../config/settings.js';
import { spawnCar } from './Car.js';
import { mechanicRate, fixingWorkMult } from './upgrades.js';

export function tick(state, dt) {
  updatePlayer(state, dt);
  updateYard(state, dt);
  updateMechanic(state, dt);
}

/** Manual repair (no mechanic needed). Requires the player at the pit. */
export function tapRepair(state) {
  const pit = state.pit;
  const car = pit.car;
  if (!pit.playerPresent || !car || car.fixed) return;
  applyRepair(state, settings.tap.tapValue);
}

/** Remote hurry: only meaningful with a mechanic; refreshes the boost window. */
export function hurry(state) {
  if (!state.upgrades.hasMechanic) return;
  state.hurryTimer = settings.hurry.duration;
}

function updateMechanic(state, dt) {
  if (state.hurryTimer > 0) state.hurryTimer = Math.max(0, state.hurryTimer - dt);
  if (!state.upgrades.hasMechanic) return;

  const car = state.pit.car;
  if (!car || car.fixed) return;

  const mult = state.hurryTimer > 0 ? settings.hurry.multiplier : 1;
  applyRepair(state, mechanicRate(state) * mult * dt);
}

/** Shared completion path for both manual taps and the mechanic. */
function applyRepair(state, amount) {
  const car = state.pit.car;
  car.repairWork = Math.min(car.totalWork, car.repairWork + amount);
  if (car.repairWork >= car.totalWork) {
    car.fixed = true;
    state.cash += car.payout;
    state.pit.car = null; // tick refills from the queue
  }
}

function updateYard(state, dt) {
  state.spawnTimer += dt;
  if (state.spawnTimer >= settings.spawn.interval && state.carQueue.length < settings.spawn.maxQueue) {
    state.carQueue.push(spawnCar(fixingWorkMult(state)));
    state.spawnTimer = 0;
  }

  if (!state.pit.car && state.carQueue.length > 0) {
    state.pit.car = state.carQueue.shift();
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
