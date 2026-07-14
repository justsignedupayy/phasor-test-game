import settings from '../config/settings.js';
import { spawnCar } from './Car.js';
import { workerSpeed, requiredTicks, ownedRightX, BAY_ZONE_Z, playerSpeedMultiplier } from './upgrades.js';
import { updateReputationTimer } from './reputation.js';
import { resolveSupermarketCollisions, resolveGarageCollisions, pushOutOfRect } from './collision.js';
import { playerRoadBoxes, pitRampAvoid } from './roads.js';
import { tickBreak, incrementJobCount } from './breaks.js';
import { onManualRepairCompleted, onPitShelfRestocked, onPitCashAccrued, onPitHurried } from './tutorial.js';

export function tick(state, dt) {
  for (const pit of state.pits) pit.collectedThisTick = 0;
  updatePlayer(state, dt);
  updateStorage(state);
  updateYard(state, dt);
  for (const pit of state.pits) updatePit(state, pit, dt);
  for (const pit of state.pits) collectPending(state, pit);
  updateReputationTimer(state, dt);
}

export function tapRepair(state, pitIndex) {
  const pit = state.pits[pitIndex];
  if (!pit || !pit.equipped) return;
  if (!pit.playerPresent) return;
  if (pit.hasMechanic && !pit.break.onBreak) return; // a working mechanic owns the pit; manual only while it rests
  const car = pit.car;
  if (!car || car.fixed) return;
  applyRepair(state, pit, settings.repair.tapTicks);
  if (car.fixed) onManualRepairCompleted(state, pitIndex);
}

export function hurry(state, pitIndex) {
  const pit = state.pits[pitIndex];
  if (!pit || !pit.hasMechanic || pit.break.onBreak) return false;
  if (!pit.mechanic) pit.mechanic = createMechanic(pitIndex); // lazily, same as updatePit
  const pos = settings.pit.positions[pitIndex];
  const M = settings.mechanic;
  const work = { x: pos.x + M.offsetX, z: pos.z + M.offsetZ };
  const m = pit.mechanic;
  if (Math.hypot(m.position.x - work.x, m.position.z - work.z) > settings.supermarket.arriveEpsilon) return false;
  pit.hurryTimer = settings.hurry.duration;
  onPitHurried(state, pitIndex); // tutorial: demonstrates the tap-to-hurry action
  return true;
}

function updatePit(state, pit, dt) {
  if (pit.hurryTimer > 0) pit.hurryTimer = Math.max(0, pit.hurryTimer - dt);
  if (!pit.hasMechanic) return;
  if (!pit.mechanic) pit.mechanic = createMechanic(pit.index); // lazily on first tick after hire

  tickBreak(pit.break, dt, state); // advance a running break; may auto-end it this frame
  updateMechanic(state, pit, dt);

  if (pit.break.onBreak) return;

  const car = pit.car;
  if (!car || car.fixed) return;

  const m = pit.mechanic;
  const M = settings.mechanic;
  const pos = settings.pit.positions[pit.index];
  const work = { x: pos.x + M.offsetX, z: pos.z + M.offsetZ };
  if (Math.hypot(m.position.x - work.x, m.position.z - work.z) > settings.supermarket.arriveEpsilon) return;

  if (car.settleRemaining > 0) return;

  const mult = pit.hurryTimer > 0 ? settings.hurry.multiplier : 1;
  applyRepair(state, pit, workerSpeed(pit) * mult * dt);
}

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

function updateMechanic(state, pit, dt) {
  const m = pit.mechanic;
  if (!m) return;
  const M = settings.mechanic;
  const S = settings.storage;
  const pos = settings.pit.positions[pit.index];
  const work = { x: pos.x + M.offsetX, z: pos.z + M.offsetZ };
  const workFacing = Math.atan2(pos.x - work.x, pos.z - work.z) + M.facingOffset;
  const speed = settings.breaks.mechanicWalkSpeed;

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

  if (pit.break.onBreak) {
    const spot = settings.breaks.breakSpots[pit.index];
    const arrived = moveMechanic(state, pit, m, spot, speed, dt);
    m.moving = !arrived;
    m.state = 'onBreak';
    m.carrying = false;
    if (arrived) m.rotation = settings.breaks.breakSpotFacing;
    return;
  }

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

function segmentHitsBox(a, b, box, r) {
  const xMin = box.xMin - r;
  const xMax = box.xMax + r;
  const zMin = box.zMin - r;
  const zMax = box.zMax + r;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let t0 = 0;
  let t1 = 1;
  const edges = [
    [-dx, a.x - xMin],
    [dx, xMax - a.x],
    [-dz, a.z - zMin],
    [dz, zMax - a.z],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false; // parallel to this slab and outside it
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 <= t1;
}

function avoidRampTarget(pit, pos, target) {
  const av = pitRampAvoid(pit.index);
  const safeX = av.xMax + settings.player.radius + 0.1;
  if (!segmentHitsBox(pos, target, av, settings.player.radius)) return target;
  if (pos.x < safeX - 0.05) return { x: safeX, z: pos.z };
  return { x: safeX, z: target.z };
}

function moveMechanic(state, pit, m, target, speed, dt) {
  const dx = target.x - m.position.x;
  const dz = target.z - m.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= 0.05) {
    m.position.x = target.x;
    m.position.z = target.z;
    return true;
  }
  const steer = avoidRampTarget(pit, m.position, target);
  const sx = steer.x - m.position.x;
  const sz = steer.z - m.position.z;
  const sdist = Math.hypot(sx, sz) || 1;
  const step = Math.min(sdist, speed * dt);
  m.position.x += (sx / sdist) * step;
  m.position.z += (sz / sdist) * step;
  m.rotation = Math.atan2(sx, sz);
  resolveGarageCollisions(state, m.position, settings.player.radius, { excludePitIndex: pit.index });
  return false;
}

function applyRepair(state, pit, ticks) {
  const car = pit.car;
  const required = requiredTicks(car, pit);
  car.ticksDone = Math.min(required, car.ticksDone + ticks);
  if (car.ticksDone >= required) {
    car.fixed = true;
    pit.tiresRemaining = Math.max(0, pit.tiresRemaining - 1); // each repair burns a tire
    if (state.hasCashier) state.cash += car.payout;
    else {
      pit.pendingCash += car.payout;
      if (pit.hasMechanic) onPitCashAccrued(state, pit.index);
    }
    pit.car = null; // updateYard refills from the queue (only while tires remain)
    if (pit.hasMechanic) incrementJobCount(pit.break, state);
  }
}

function updateStorage(state) {
  const S = settings.storage;
  const player = state.player;

  for (const pit of state.pits) {
    if (!pit.equipped) continue;
    if (!state.autoRestock && !player.carryingBox && !player.carryingRestockBox && pit.playerNearShelf && pit.shelfBoxes > 0) {
      player.carryingBox = true;
      player.carryingBoxPitIndex = pit.index;
    } else if (player.carryingBox && player.carryingBoxPitIndex === pit.index && pit.playerPresent) {
      player.carryingBox = false;
      player.carryingBoxPitIndex = null;
      pit.tiresRemaining = S.maxTiresPerPit; // delivered box refills the stack
      onPitShelfRestocked(state, pit.index);
    }
  }
}

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
    spawnToMatchingPit(state);
    state.spawnTimer = 0;
  }

  for (const pit of state.pits) {
    if (pit.equipped && pit.tiresRemaining > 0 && !pit.car && pit.queue.length > 0) {
      pit.car = pit.queue.shift();
      pit.car.settleRemaining = settings.pit.driveDuration;
    }
  }

  for (const pit of state.pits) {
    if (pit.car && pit.car.settleRemaining > 0) {
      pit.car.settleRemaining = Math.max(0, pit.car.settleRemaining - dt);
    }
  }
}

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

    const speed = settings.player.speed * playerSpeedMultiplier(state);
    player.position.x += dirX * speed * m * dt;
    player.position.z += dirZ * speed * m * dt;
    clampToBounds(state, player.position);

    player.rotation = Math.atan2(dirX, dirZ);
    player.moving = true;
  } else {
    player.moving = false;
  }

  resolveSupermarketCollisions(state, player.position, settings.player.radius);
  resolveGarageCollisions(state, player.position, settings.player.radius, {
    roomWallX: ownedRightX(state),
  });
  for (const b of playerRoadBoxes(state)) {
    pushOutOfRect(player.position, settings.player.radius, b);
  }

  const G = settings.gasStation.positions;
  const lastPump = state.gasStation.pumps[G.length - 1];
  if (lastPump.equipped) {
    const p = G[G.length - 1];
    if (player.position.x < p.x - settings.pitLane.halfWidth - 0.3) {
      player.position.x = p.x + settings.unlockMarkers.hireOffset.x;
      player.position.z = p.z + settings.unlockMarkers.hireOffset.z;
    }
  }
}

function clampToBounds(state, pos) {
  const W = settings.world;
  const M = settings.supermarket;
  const r = settings.player.radius;
  const t = W.wallThickness;
  const limX = W.halfX - r;
  const limZ = W.halfZ - r;
  const rightLim = (pos.z > BAY_ZONE_Z ? ownedRightX(state) : W.halfX) - r;

  const atGasGate =
    state.gasStation.pumps[0].roomUnlocked && Math.abs(pos.z - settings.gasStation.gateZ) <= W.gateHalf;
  pos.x = Math.min(rightLim, pos.x);
  pos.x = Math.max(settings.gasStation.leftLimitX + r, pos.x);
  if (!atGasGate) {
    if (pos.x > -W.halfX - t / 2) pos.x = Math.max(-limX, pos.x); // inside: held off the inner face
    else pos.x = Math.min(-W.halfX - t - r, pos.x); // outside: held off the outer face
  }

  const atDeliveryGate =
    state.supermarket && state.supermarket.unlocked && Math.abs(pos.x - M.deliveryDoorX) <= W.gateHalf;
  pos.z = Math.min(limZ, pos.z);
  if (!atDeliveryGate) {
    if (pos.z > -W.halfZ - t / 2) pos.z = Math.max(-limZ, pos.z);
    else pos.z = Math.min(-W.halfZ - t - r, pos.z);
  }
}
