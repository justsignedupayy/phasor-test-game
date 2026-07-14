import settings from '../config/settings.js';
import { spawnGasCar } from './Car.js';
import { attendantSpeed } from './upgrades.js';
import { resolveGarageCollisions } from './collision.js';
import { tickBreak, incrementJobCount } from './breaks.js';

export function tickGasStation(state, dt) {
  const pumps = state.gasStation.pumps;
  for (const pump of pumps) pump.collectedThisTick = 0;
  updateStationYard(state, dt);
  for (const pump of pumps) updatePump(state, pump, dt);
  for (const pump of pumps) collectPending(state, pump);
}

export function tapFill(state, pumpIndex) {
  const pump = state.gasStation.pumps[pumpIndex];
  if (!pump || !pump.equipped) return;
  if (!pump.playerPresent && !pump.hasAttendant) return;
  const car = pump.car;
  if (!car || car.fixed) return;
  applyFill(state, pump, settings.repair.tapTicks);
}

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

export function requiredFillTicks(car) {
  return car.fillTicks;
}

function updatePump(state, pump, dt) {
  if (pump.hurryTimer > 0) pump.hurryTimer = Math.max(0, pump.hurryTimer - dt);
  if (!pump.hasAttendant) return;
  if (!pump.attendant) pump.attendant = createAttendant(pump.index); // lazily on first tick after hire

  tickBreak(pump.break, dt, state);
  updateAttendant(state, pump, dt);

  if (pump.break.onBreak) return;

  const car = pump.car;
  if (!car || car.fixed) return;

  const a = pump.attendant;
  const work = workSpot(pump.index);
  if (Math.hypot(a.position.x - work.x, a.position.z - work.z) > settings.supermarket.arriveEpsilon) return;

  if (car.settleRemaining > 0) return;

  const mult = pump.hurryTimer > 0 ? settings.hurry.multiplier : 1;
  applyFill(state, pump, attendantSpeed(pump) * mult * dt);
}

function workSpot(pumpIndex) {
  const pos = settings.gasStation.positions[pumpIndex];
  const A = settings.attendant;
  return { x: pos.x + A.offsetX, z: pos.z + A.offsetZ };
}

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

function updateAttendant(state, pump, dt) {
  const a = pump.attendant;
  if (!a) return;
  const pos = settings.gasStation.positions[pump.index];
  const work = workSpot(pump.index);
  const workFacing = Math.atan2(pos.x - work.x, pos.z - work.z) + settings.attendant.facingOffset;
  const speed = settings.breaks.mechanicWalkSpeed;

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

function applyFill(state, pump, ticks) {
  const car = pump.car;
  const required = requiredFillTicks(car);
  car.ticksDone = Math.min(required, car.ticksDone + ticks);
  if (car.ticksDone >= required) {
    car.fixed = true;
    if (state.hasCashier) state.cash += car.payout;
    else pump.pendingCash += car.payout;
    pump.car = null; // updateStationYard refills from the queue
    if (pump.hasAttendant) incrementJobCount(pump.break, state);
  }
}

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
