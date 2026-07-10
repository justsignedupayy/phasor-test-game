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
import { workerSpeed, requiredTicks, ownedRightX, BAY_ZONE_Z, playerSpeedMultiplier } from './upgrades.js';
import { updateReputationTimer } from './reputation.js';
import { resolveSupermarketCollisions, resolveGarageCollisions, pushOutOfRect } from './collision.js';
import { playerRoadBoxes, pitRampAvoid } from './roads.js';
import { tickBreak, incrementJobCount } from './breaks.js';
import { onManualRepairCompleted, onPitShelfRestocked, onPitCashAccrued, onPitHurried } from './tutorial.js';

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
  // Tutorial step 1 counts COMPLETED manual repairs: only the tap that actually
  // finished the car decrements the countdown — mid-repair taps never count
  // (no-op once the tutorial moves on).
  if (car.fixed) onManualRepairCompleted(state, pitIndex);
}

/**
 * Remote hurry: only meaningful with a worker actually at its work spot beside
 * the car (not on break, not still walking back from one) — the same arrival
 * gate updatePit uses before it lets the mechanic auto-repair. Returns whether
 * the boost was actually applied, so callers can skip the yell reaction otherwise.
 */
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

  // Advance the break clock, then the mechanic's movement FSM (its break-walk and,
  // with auto-restock owned, its box-fetch trip). Both run regardless of a car.
  tickBreak(pit.break, dt, state); // advance a running break; may auto-end it this frame
  updateMechanic(state, pit, dt);

  // On break: the worker leans at its break spot and does no auto-repair. Cars
  // still queue/pull into the pit as usual (they just wait), identical to an idle pit.
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
 * walks to its break spot and leans against the wall). Without the upgrade it just
 * holds its work spot — the pit stays dry until the player restocks (unchanged
 * behaviour).
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

  // On break: walk to this pit's break spot and lean (no restock/repair meanwhile).
  if (pit.break.onBreak) {
    const spot = settings.breaks.breakSpots[pit.index];
    const arrived = moveMechanic(state, pit, m, spot, speed, dt);
    m.moving = !arrived;
    m.state = 'onBreak';
    m.carrying = false;
    if (arrived) m.rotation = settings.breaks.breakSpotFacing;
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
 * Liang–Barsky test: does segment a→b enter the axis-aligned `box`
 * ({ xMin, xMax, zMin, zMax }) grown by `r` on every side? (So a body of radius r
 * that would graze the box counts as a hit.)
 */
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

/**
 * Steer the mechanic AROUND its own pit's +x bridge ramp (roads.pitRampAvoid)
 * rather than straight through its sloped footprint. When the direct line to
 * `target` would enter the ramp box, return an intermediate waypoint just east of
 * the ramp tip — first square out east at the current z (clear of the ramp's
 * z-band), then run in z once past the tip (an L around the ramp). Returns
 * `target` unchanged when the path is already clear. The ramp top is a walkable
 * crossing so it can't be a collision box (that would trap this worker and wall
 * the player off the bridge); this steering is the pit worker's way to respect it.
 */
function avoidRampTarget(pit, pos, target) {
  const av = pitRampAvoid(pit.index);
  const safeX = av.xMax + settings.player.radius + 0.1;
  if (!segmentHitsBox(pos, target, av, settings.player.radius)) return target;
  if (pos.x < safeX - 0.05) return { x: safeX, z: pos.z };
  return { x: safeX, z: target.z };
}

/**
 * Step toward `target` at `speed`, routing around the pit's own bridge ramp
 * (avoidRampTarget) rather than cutting through it, then push the mechanic out of
 * every garage prop except its OWN pit's (so it can stand on its own shelf / work
 * spot / break spot) — the same push-out the player gets. Arrival is judged
 * against the REAL target; returns true once it reaches it.
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
    else {
      pit.pendingCash += car.payout;
      // Only a hired worker's own repair counts for the tutorial's "worker
      // banked cash" step — a manual-tap completion before hireMechanic (the
      // 'repairCars' step) shouldn't retroactively satisfy it.
      if (pit.hasMechanic) onPitCashAccrued(state, pit.index);
    }
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
      // Tutorial step 2: this delivery path is player-only (the mechanic's
      // auto-restock runs through updateMechanic, never here).
      onPitShelfRestocked(state, pit.index);
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

    const speed = settings.player.speed * playerSpeedMultiplier(state);
    player.position.x += dirX * speed * m * dt;
    player.position.z += dirZ * speed * m * dt;
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
  // ...and out of every garage prop (per-pit shelves, tire stacks)
  // plus the room's right (fence) wall at ownedRightX — the one expanding wall the
  // clampToBounds above leaves open in the front lane (z <= BAY_ZONE_Z).
  resolveGarageCollisions(state, player.position, settings.player.radius, {
    roomWallX: ownedRightX(state),
  });
  // Vehicle roads are solid to the player ALONE (never to NPCs — attendants and
  // mechanics work on the lanes). The car lanes themselves are fenced by the
  // invisible walls in resolveGarageCollisions above (pit/pump lane boxes),
  // crossed only over their raised bridges (see core/roads.js).
  for (const b of playerRoadBoxes(state)) {
    pushOutOfRect(player.position, settings.player.radius, b);
  }

  // Safety net: once the LAST pump is equipped, the ground strip past its lane
  // (west of the lane's -x face, out to leftLimitX) is sealed on every side —
  // lane walls east, the spine's end cap above, the outer wall west — with no
  // spur or ramp in. No legitimate path leads there, so a player found in it
  // (a stale save, an unforeseen push-out) is stranded; return them to that
  // pump's hire-marker spot, the nearest normal ground east of the lane. The
  // 0.3 margin is the end cap's full reach, so a deck walker (x >= the spine
  // piece's xMin, held off the cap) never trips this.
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

/**
 * In bay territory, the right edge is fenced to whatever land is owned; the lane
 * is always open. The back wall is solid: the player stays inside the building.
 * The front wall is solid too, EXCEPT the supermarket delivery-door gap
 * (deliveryDoorX): once the market is open the player may step out through it to
 * reach the restock pile just outside, the same gate the market worker uses
 * (see clampFallbackToWalls). The LEFT wall opens the same way at the gas-station
 * gate (gasStation.gateZ) — but only once the station exists (the first Expand
 * Station purchase opens pump lot 0); before that the wall is fully solid,
 * exactly like the delivery gate before the market is unlocked. Out at the
 * station the world still ends: an invisible wall at the pump row's far edge
 * (gasStation.leftLimitX) caps x on the left, and the z clamps below keep
 * applying, so the walkable station is the band between the wall planes.
 *
 * Each openable wall is treated as a two-sided SLAB (inner face at ±half, outer
 * face a wallThickness beyond): off-gate, a mover is held off whichever face it
 * is on — the side is read against the slab's mid-plane, unambiguous because a
 * per-frame step is far smaller than slab + radius. This blocks inside→outside
 * and outside→inside identically; the old "already past the wall plane"
 * allowance read the POST-move position, which let an outside mover that
 * crossed the plane in one step register as inside and get pulled through.
 */
function clampToBounds(state, pos) {
  const W = settings.world;
  const M = settings.supermarket;
  const r = settings.player.radius;
  const t = W.wallThickness;
  const limX = W.halfX - r;
  const limZ = W.halfZ - r;
  const rightLim = (pos.z > BAY_ZONE_Z ? ownedRightX(state) : W.halfX) - r;

  // Left wall: solid both ways except the gas-station gate at gateZ. The gate
  // exists only once the station's first lot is bought.
  const atGasGate =
    state.gasStation.pumps[0].roomUnlocked && Math.abs(pos.z - settings.gasStation.gateZ) <= W.gateHalf;
  pos.x = Math.min(rightLim, pos.x);
  // The gas station's outer edge is ALWAYS solid: an invisible wall at the far
  // side of the pump row (settings.gasStation.leftLimitX, derived from the pump
  // positions) so walking out through the gas gate never leaves the game area.
  // Applied unconditionally — inside the building the inner-face clamp below is
  // far tighter, so this only ever bites out at the station.
  pos.x = Math.max(settings.gasStation.leftLimitX + r, pos.x);
  if (!atGasGate) {
    if (pos.x > -W.halfX - t / 2) pos.x = Math.max(-limX, pos.x); // inside: held off the inner face
    else pos.x = Math.min(-W.halfX - t - r, pos.x); // outside: held off the outer face
  }

  // Back wall is always solid; the front wall opens ONLY within gateHalf of the
  // delivery-door x — same two-sided slab treatment as the left wall.
  const atDeliveryGate =
    state.supermarket && state.supermarket.unlocked && Math.abs(pos.x - M.deliveryDoorX) <= W.gateHalf;
  pos.z = Math.min(limZ, pos.z);
  if (!atDeliveryGate) {
    if (pos.z > -W.halfZ - t / 2) pos.z = Math.max(-limZ, pos.z);
    else pos.z = Math.min(-W.halfZ - t - r, pos.z);
  }
}
