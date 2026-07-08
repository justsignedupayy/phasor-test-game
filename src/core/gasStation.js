/**
 * gasStation.js — all gas-station mutation lives here. No Three.js.
 * A 1:1 mirror of simulation.js's pit flow, for the pump row in the world's
 * left quadrant (see settings.gasStation):
 *
 *   tickGasStation(state, dt)     advance the station: spawning, queue→pumps,
 *                                 and each hired attendant's automatic fill.
 *   tapFill(state, pumpIndex)     manual fill tap on one pump (adds tapTicks).
 *   hurryPump(state, pumpIndex)   remote boost: temporarily speeds that pump's attendant.
 *
 * UNLIKE pits there is NO tier routing here: any car tier fills up at any pump.
 * A spawned car simply joins the shortest line — the equipped pump with the
 * fewest cars (its bay + its queue) — and is discarded only when every open
 * pump's queue is full. Otherwise cars queue behind gasStation.doorZ, drive in,
 * settle, get filled, pay out, and leave — the exact spawn/queue/settle/complete
 * cycle pits run, minus the pit-only tire system. Attendants take breaks exactly
 * like mechanics: a wall-lean break spot beside each pump
 * (settings.breaks.pumpBreakSpots), a job per filled car.
 */
import settings from '../config/settings.js';
import { spawnGasCar } from './Car.js';
import { attendantSpeed } from './upgrades.js';
import { resolveGarageCollisions } from './collision.js';
import { tickBreak, incrementJobCount } from './breaks.js';

export function tickGasStation(state, dt) {
  const pumps = state.gasStation.pumps;
  // collectedThisTick is a one-tick render signal (mirrors pit.collectedThisTick).
  for (const pump of pumps) pump.collectedThisTick = 0;
  updateStationYard(state, dt);
  for (const pump of pumps) updatePump(state, pump, dt);
  // Collect after every pump has run, so pay produced THIS tick is banked the
  // same tick when the player is standing there — same ordering as tick().
  for (const pump of pumps) collectPending(state, pump);
}

/**
 * Manual fill on one pump. Allowed if the pump is equipped and either the player
 * is standing there or an attendant is hired — mirrors tapRepair exactly.
 */
export function tapFill(state, pumpIndex) {
  const pump = state.gasStation.pumps[pumpIndex];
  if (!pump || !pump.equipped) return;
  if (!pump.playerPresent && !pump.hasAttendant) return;
  const car = pump.car;
  if (!car || car.fixed) return;
  applyFill(state, pump, settings.repair.tapTicks);
}

/**
 * Remote hurry: only meaningful with an attendant actually at its work spot
 * beside the pump (not on break, not still walking back from one) — mirrors
 * hurry()'s arrival gate. Returns whether the boost was actually applied.
 */
export function hurryPump(state, pumpIndex) {
  const pump = state.gasStation.pumps[pumpIndex];
  if (!pump || !pump.hasAttendant || pump.break.onBreak) return false;
  if (!pump.attendant) pump.attendant = createAttendant(pumpIndex); // lazily, same as updatePump
  const a = pump.attendant;
  const work = workSpot(pumpIndex);
  if (Math.hypot(a.position.x - work.x, a.position.z - work.z) > settings.supermarket.arriveEpsilon) return false;
  pump.hurryTimer = settings.hurry.duration;
  return true;
}

/** Ticks a pump actually needs to finish a given car (no fixing-time upgrade at pumps). */
export function requiredFillTicks(car) {
  return car.fillTicks;
}

function updatePump(state, pump, dt) {
  if (pump.hurryTimer > 0) pump.hurryTimer = Math.max(0, pump.hurryTimer - dt);
  if (!pump.hasAttendant) return;
  if (!pump.attendant) pump.attendant = createAttendant(pump.index); // lazily on first tick after hire

  // Advance the break clock, then the attendant's movement FSM (its break-walk
  // to the spot beside the pump) — same ordering as a pit's updatePit.
  tickBreak(pump.break, dt);
  updateAttendant(state, pump, dt);

  // On break: the attendant leans at its break spot and does no auto-fill. Cars
  // still queue/pull into the pump as usual (they just wait), identical to a pit.
  if (pump.break.onBreak) return;

  const car = pump.car;
  if (!car || car.fixed) return;

  // Don't start filling until the attendant has physically reached its work spot
  // beside the pump — the same arrival gate the mechanic has.
  const a = pump.attendant;
  const work = workSpot(pump.index);
  if (Math.hypot(a.position.x - work.x, a.position.z - work.z) > settings.supermarket.arriveEpsilon) return;

  // ...and not until the car itself has finished driving in and settled at the pump.
  if (car.settleRemaining > 0) return;

  const mult = pump.hurryTimer > 0 ? settings.hurry.multiplier : 1;
  applyFill(state, pump, attendantSpeed(pump) * mult * dt);
}

// --- the pump attendant: a core-owned NPC, mirroring the pit mechanic ---------

/** This pump's work spot: beside the car, offset like the mechanic's. */
function workSpot(pumpIndex) {
  const pos = settings.gasStation.positions[pumpIndex];
  const A = settings.attendant;
  return { x: pos.x + A.offsetX, z: pos.z + A.offsetZ };
}

/** A freshly hired attendant, standing at its work spot beside the pump, facing the car. */
function createAttendant(pumpIndex) {
  const pos = settings.gasStation.positions[pumpIndex];
  const { x, z } = workSpot(pumpIndex);
  return {
    position: { x, z },
    rotation: Math.atan2(pos.x - x, pos.z - z) + settings.attendant.facingOffset,
    moving: false,
    carrying: false, // attendants never haul boxes; kept so the shared render FSM reads clean
    state: 'idle', // 'idle' | 'onBreak'
  };
}

/**
 * Advance one pump attendant each tick, mirroring updateMechanic minus its
 * restock leg (pumps have no tires): on break it walks to its own break spot
 * beside the pump and leans there; otherwise it holds (returns to) the work
 * spot, facing the car.
 */
function updateAttendant(state, pump, dt) {
  const a = pump.attendant;
  if (!a) return;
  const pos = settings.gasStation.positions[pump.index];
  const work = workSpot(pump.index);
  const workFacing = Math.atan2(pos.x - work.x, pos.z - work.z) + settings.attendant.facingOffset;
  const speed = settings.breaks.mechanicWalkSpeed;

  // On break: walk to this pump's break spot and lean (no fill meanwhile).
  if (pump.break.onBreak) {
    const spot = settings.breaks.pumpBreakSpots[pump.index];
    const arrived = moveAttendant(state, pump, a, spot, speed, dt);
    a.moving = !arrived;
    a.state = 'onBreak';
    if (arrived) a.rotation = settings.breaks.breakSpotFacing;
    return;
  }

  const arrived = moveAttendant(state, pump, a, work, speed, dt);
  a.moving = !arrived;
  a.state = 'idle';
  if (arrived) a.rotation = workFacing;
}

/**
 * Straight-line step toward `target`, then push the attendant out of every solid
 * prop except its OWN pump's — the same push-out moveMechanic applies. Returns
 * true once it reaches the target.
 */
function moveAttendant(state, pump, a, target, speed, dt) {
  const dx = target.x - a.position.x;
  const dz = target.z - a.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= 0.05) {
    a.position.x = target.x;
    a.position.z = target.z;
    return true;
  }
  const step = Math.min(dist, speed * dt);
  a.position.x += (dx / dist) * step;
  a.position.z += (dz / dist) * step;
  a.rotation = Math.atan2(dx, dz);
  resolveGarageCollisions(state, a.position, settings.player.radius, { excludePumpIndex: pump.index });
  return false;
}

/**
 * Shared completion path for both manual taps and the attendant — applyRepair's
 * mirror. The payout routes by cashier: banked instantly with one hired,
 * otherwise parked at the pump (pump.pendingCash) for the player to collect on
 * proximity. Either way the car leaves so the pump can take the next one.
 */
function applyFill(state, pump, ticks) {
  const car = pump.car;
  const required = requiredFillTicks(car);
  car.ticksDone = Math.min(required, car.ticksDone + ticks);
  if (car.ticksDone >= required) {
    car.fixed = true;
    if (state.hasCashier) state.cash += car.payout;
    else pump.pendingCash += car.payout;
    pump.car = null; // updateStationYard refills from the queue
    // A filled car counts a job toward this attendant's break (only a hired
    // attendant takes breaks — a manual tap-fill with no attendant doesn't).
    if (pump.hasAttendant) incrementJobCount(pump.break);
  }
}

/**
 * Bank a pump's waiting pay on proximity (scene writes playerPresent, core only
 * reads it) — collectPending's mirror. A cashier collects from anywhere.
 */
function collectPending(state, pump) {
  if (pump.pendingCash <= 0) return;
  if (!state.hasCashier && !pump.playerPresent) return;
  state.cash += pump.pendingCash;
  pump.collectedThisTick = pump.pendingCash; // render signal for the "+$" popup
  pump.pendingCash = 0;
}

function updateStationYard(state, dt) {
  const G = state.gasStation;
  G.spawnTimer += dt;
  if (G.spawnTimer >= settings.gasStation.spawn.interval) {
    spawnToShortestQueue(state);
    G.spawnTimer = 0;
  }

  // Per-pump routing: a free equipped pump pulls the front of its OWN queue and
  // holds the car for the drive-in settle window — mirrors updateYard exactly.
  for (const pump of G.pumps) {
    if (pump.equipped && !pump.car && pump.queue.length > 0) {
      pump.car = pump.queue.shift();
      pump.car.settleRemaining = settings.gasStation.driveDuration;
    }
  }

  for (const pump of G.pumps) {
    if (pump.car && pump.car.settleRemaining > 0) {
      pump.car.settleRemaining = Math.max(0, pump.car.settleRemaining - dt);
    }
  }
}

/**
 * Generate one gas car and route it to the shortest line: the equipped pump
 * with the fewest cars (the one in its bay + its queue), ties going to the
 * lowest index. NO tier matching — any tier fills up at any pump (the tier
 * still drives the car's model and payout). The car is discarded only when no
 * equipped pump has queue room.
 */
function spawnToShortestQueue(state) {
  const car = spawnGasCar(state);
  let best = null;
  let bestLoad = Infinity;
  for (const pump of state.gasStation.pumps) {
    if (!pump.equipped || pump.queue.length >= settings.gasStation.spawn.maxQueuePerPump) continue;
    const load = pump.queue.length + (pump.car ? 1 : 0);
    if (load < bestLoad) {
      best = pump;
      bestLoad = load;
    }
  }
  if (!best) return; // every open pump is full (or none open) — discard the car
  best.queue.push(car);
}
