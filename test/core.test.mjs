/**
 * Zero-dependency core tests. Proves movement + spawning + the multi-pit tick
 * repair/queue logic run and are correct entirely without Three.js.
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { createInitialState } from '../src/core/GameState.js';
import { tick, tapRepair, hurry } from '../src/core/simulation.js';
import { tickGasStation, tapFill, hurryPump, requiredFillTicks } from '../src/core/gasStation.js';
import { spawnCar, spawnGasCar, tierWeights } from '../src/core/Car.js';
import {
  buyExpandRoom,
  buyPitEquipment,
  hireMechanic,
  buyWorkerSpeed,
  buyFixingTime,
  buyCashier,
  buyAutoRestock,
  autoRestockCost,
  cashierCost,
  workerSpeed,
  fixTimeFactor,
  requiredTicks,
  expandRoomCost,
  pitEquipmentCost,
  ownedRightX,
  allLandOwned,
  buySupermarket,
  hireMarketWorker,
  trainMarketWorker,
  supermarketCost,
  marketWorkerHireCost,
  marketWorkerTrainCost,
  buyTruckFrequency,
  truckFrequencyCost,
  buyGasExpand,
  buyGasEquipment,
  hireAttendant,
  buyAttendantSpeed,
  gasExpandCost,
  gasEquipmentCost,
  attendantSpeed,
  gasStationPrereqs,
  getUnlockMarkers,
  buyUnlockMarker,
  hireCost,
  buyBreakDuration,
  breakDurationCost,
  buyPlayerSpeed,
  playerSpeedCost,
  playerSpeedMultiplier,
} from '../src/core/upgrades.js';
import {
  createBreakState,
  incrementJobCount,
  tickBreak,
  endBreak,
  breakDuration,
  breakDurationAtLevel,
  breakRemaining,
} from '../src/core/breaks.js';
import {
  getEffectiveReputation,
  buyAdvertising,
  watchAdForReputation,
  adCost,
} from '../src/core/reputation.js';
import { formatMoney } from '../src/core/format.js';
import {
  spawnCustomer,
  tickSupermarket,
  buyProduct,
  placeAtCheckout,
  restockShelf,
  checkoutCustomer,
  frontCustomer,
  computeTotal,
  takeRestockUnit,
  tickTruck,
  deliverStock,
  callTruckEarly,
  orderTruck,
  truckDeliveryTime,
} from '../src/core/supermarket.js';
import settings from '../src/config/settings.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓', name);
}

// --- movement -------------------------------------------------------------
console.log('core simulation (3D movement)');

check('initial state: $0, player inside pit 0\'s owned bay, not moving', () => {
  const s = createInitialState();
  assert.equal(s.cash, 0);
  // Beside pit 0's work area — just EAST of its fenced car lane (settings.pitLane),
  // never inside the lane walls.
  assert.deepEqual(s.player.position, { x: -24.5, z: 0 });
  assert.equal(s.player.moving, false);
});

check('full input for 1s travels exactly `speed` units', () => {
  const s = createInitialState();
  const z0 = s.player.position.z;
  s.input.z = 1;
  tick(s, 1);
  assert.ok(Math.abs(s.player.position.z - z0 - settings.player.speed) < 1e-6);
});

check('diagonal input is not faster than cardinal', () => {
  const s = createInitialState();
  const { x: x0, z: z0 } = s.player.position;
  s.input.x = 1;
  s.input.z = 1;
  const dt = 0.05; // small step so the move doesn't reach the land fence or any wall
  tick(s, dt);
  const dist = Math.hypot(s.player.position.x - x0, s.player.position.z - z0);
  assert.ok(Math.abs(dist - settings.player.speed * dt) < 1e-6);
});

check('player rotates to face movement (+x → PI/2)', () => {
  const s = createInitialState();
  s.input.x = 1;
  tick(s, 0.016);
  assert.ok(Math.abs(s.player.rotation - Math.PI / 2) < 1e-6);
});

check("in the open (front) zone, the room's right wall blocks at the owned boundary", () => {
  const s = createInitialState();
  s.player.position.z = -5; // z <= BAY_ZONE_Z: the open front lane
  s.input.x = 1;
  for (let i = 0; i < 200; i++) tick(s, 0.1);
  // The room's right (fence) wall is now a solid collision box (buildGarageBoxes'
  // roomWallX) in the front lane too, not just the bay — so the player stops at the
  // owned boundary (ownedRightX) instead of sliding all the way to the outer wall.
  const fenceLim = ownedRightX(s) - settings.player.radius;
  assert.ok(s.player.position.x <= fenceLim + 1e-6, 'should stop at the room right wall');
  assert.ok(s.player.position.x < settings.world.halfX - settings.player.radius, 'and never reach the outer wall');
});

check('in the bay row, position clamps to owned land only (fenced off otherwise)', () => {
  const s = createInitialState();
  s.input.x = 1;
  for (let i = 0; i < 200; i++) tick(s, 0.1); // z stays 0: bay territory the whole time
  const limX = ownedRightX(s) - settings.player.radius;
  assert.ok(s.player.position.x <= limX + 1e-9, 'should not cross the fence into unowned land');
  assert.ok(s.player.position.x < settings.world.halfX - settings.player.radius, 'fence is well short of the outer wall with only pit 0 owned');
});

check('buying more land moves the fence (and the bay clamp) further right', () => {
  const s = createInitialState();
  const before = ownedRightX(s);
  s.cash = 1e9;
  s.permanentReputation = settings.reputation.repCap; // clear every lot's rep gate
  buyExpandRoom(s);
  const after = ownedRightX(s);
  assert.ok(after > before);
});

check('once every pit is owned, the fence settles at the last lot, short of the far wall', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = settings.reputation.repCap; // clear every lot's rep gate
  while (!allLandOwned(s)) buyExpandRoom(s);
  // The wide garage puts the outer wall a full pit-spacing past the last pit, so
  // the fence settles at the last lot's edge — within, not at, the outer wall.
  const fence = ownedRightX(s);
  assert.ok(fence > settings.pit.positions[settings.maxPits - 1].x, 'fence sits just past the last pit');
  assert.ok(fence <= settings.world.halfX, 'fence never crosses the outer wall');
});

// --- pit setup ------------------------------------------------------------
console.log('\ncore pit setup');

check('initial state: pit 0 unlocked + equipped, the rest locked', () => {
  const s = createInitialState();
  assert.equal(s.pits.length, settings.maxPits);
  assert.equal(s.pits[0].roomUnlocked, true);
  assert.equal(s.pits[0].equipped, true);
  for (let i = 1; i < s.pits.length; i++) {
    assert.equal(s.pits[i].roomUnlocked, false);
    assert.equal(s.pits[i].equipped, false);
  }
});

// --- spawning + queue -----------------------------------------------------
console.log('\ncore spawning + queue');

check('initial state: empty pits, empty queues, spawn seeded', () => {
  const s = createInitialState();
  assert.equal(s.pits[0].car, null);
  for (const pit of s.pits) assert.equal(pit.queue.length, 0);
  assert.equal(s.spawnTimer, settings.spawn.interval);
});

check('first tick puts a car straight into pit 0', () => {
  const s = createInitialState();
  s.permanentReputation = 0; // every car is rusty → routes to pit 0
  tick(s, settings.spawn.interval);
  assert.ok(s.pits[0].car);
  assert.equal(s.pits[0].queue.length, 0); // routed straight in, nothing left waiting
});

check("spawning is automatic and fills pit 0 to maxQueuePerPit (pit's car + full queue)", () => {
  const s = createInitialState();
  s.permanentReputation = 0; // every car is rusty → routes to pit 0
  for (let i = 0; i < 30; i++) tick(s, settings.spawn.interval); // nobody repairs
  assert.ok(s.pits[0].car); // pit 0 holds one
  assert.equal(s.pits[0].queue.length, settings.spawn.maxQueuePerPit); // its queue is full, extra cars discarded
});

check('pit refills from the front of its own queue after a fix', () => {
  const s = createInitialState();
  s.permanentReputation = 0; // every car is rusty → routes to pit 0
  for (let i = 0; i < 30; i++) tick(s, settings.spawn.interval);
  const front = s.pits[0].queue[0];
  s.pits[0].car = null; // simulate the pit car being finished
  tick(s, 0.001);
  assert.equal(s.pits[0].car.id, front.id);
  assert.equal(s.pits[0].queue.length, settings.spawn.maxQueuePerPit - 1);
});

check('locked/unequipped pits never get a car or a queue', () => {
  const s = createInitialState();
  for (let i = 0; i < 30; i++) tick(s, settings.spawn.interval);
  for (let i = 1; i < s.pits.length; i++) {
    assert.equal(s.pits[i].car, null);
    assert.equal(s.pits[i].queue.length, 0);
  }
});

check('rusty cars route only to pit 0 (matching tier)', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = settings.reputation.repCap; // clear the rep gate for the buys
  buyExpandRoom(s);
  buyPitEquipment(s, 1); // pits 0 and 1 now equipped
  s.permanentReputation = 0; // every car is rusty → matches pit 0 only
  // Occupy both pits so routing never drains their queues during this test.
  s.pits[0].car = spawnCar(s);
  s.pits[1].car = spawnCar(s);
  for (let i = 0; i < 30; i++) tick(s, settings.spawn.interval);
  assert.equal(s.pits[0].queue.length, settings.spawn.maxQueuePerPit); // pit 0 fills, rest discarded
  assert.equal(s.pits[1].queue.length, 0); // pit 1 never gets a rusty car
});

check('every queued car matches its pit tier (pit i ↔ carTiers[i])', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = settings.reputation.repCap; // clear every lot's rep gate for the buys
  for (let i = 1; i < settings.maxPits; i++) {
    buyExpandRoom(s); // unlocks pits in order (1, 2, 3, 4)
    buyPitEquipment(s, i);
  }
  assert.equal(s.pits.length, 5);
  s.permanentReputation = 0.5; // spread the roll across the middle tiers
  // Occupy every pit so routing never drains their queues during this test.
  for (const pit of s.pits) pit.car = spawnCar(s);
  for (let i = 0; i < 200; i++) tick(s, settings.spawn.interval);
  s.pits.forEach((pit, idx) => {
    const tierName = settings.carTiers[idx].name;
    for (const car of pit.queue) assert.equal(car.tier, tierName);
  });
});

check('a car whose matching pit is not equipped is discarded', () => {
  const s = createInitialState();
  // rep 0.25 → 50% rusty (→ pit 0, equipped) + 50% normal (→ pit 1, unequipped).
  s.permanentReputation = 0.25;
  for (let i = 0; i < 60; i++) tick(s, settings.spawn.interval);
  assert.ok(s.pits[0].car || s.pits[0].queue.length > 0); // rusty cars landed at pit 0
  for (let i = 1; i < s.pits.length; i++) {
    assert.equal(s.pits[i].car, null); // normal cars had no equipped pit → discarded
    assert.equal(s.pits[i].queue.length, 0);
  }
});

// --- randomized damage ----------------------------------------------------
console.log('\ncore randomized damage');

// Reputation at 0 forces every roll to the lowest tier ('rusty'), so these
// tests stay deterministic about the per-part formulas.
const zeroRepState = () => {
  const s = createInitialState();
  s.permanentReputation = 0;
  return s;
};

check('spawnCar: non-empty canonical subset; ticks + payout scale with parts and the rolled tier', () => {
  const canon = ['tire', 'smoke', 'dent'];
  const rusty = settings.carTiers[0];
  const s = zeroRepState();
  for (let i = 0; i < 300; i++) {
    const car = spawnCar(s);
    const n = car.damageParts.length;
    assert.ok(n >= 1 && n <= 3);
    assert.deepEqual(car.damageParts, canon.filter((p) => car.damageParts.includes(p)));
    assert.equal(car.tier, 'rusty');
    assert.ok(Math.abs(car.baseTicks - settings.repair.ticksPerPart * n * rusty.ticksMult) < 1e-9);
    assert.ok(Math.abs(car.payout - settings.spawn.basePayoutPerPart * n * rusty.payoutMult) < 1e-9);
    assert.equal(car.ticksDone, 0);
    assert.equal(car.fixed, false);
  }
});

check('spawnCar produces variety (1-, 2- and 3-damage cars appear)', () => {
  const counts = new Set();
  const s = zeroRepState();
  for (let i = 0; i < 400; i++) counts.add(spawnCar(s).damageParts.length);
  assert.ok(counts.has(1) && counts.has(2) && counts.has(3));
});

check('a standard 3-damage car needs ~15 ticks at base fixing time', () => {
  const s = createInitialState();
  const car = { baseTicks: settings.repair.ticksPerPart * 3 };
  assert.equal(requiredTicks(car, s.pits[0]), 15);
});

// --- repair loop ----------------------------------------------------------
console.log('\ncore repair loop');

check('tapRepair needs a present player and a car in the pit', () => {
  const s = createInitialState();
  s.permanentReputation = 0; // rusty car → routes to pit 0
  tick(s, settings.spawn.interval); // car now in pit 0
  s.pits[0].car.baseTicks = 1e6; // keep a single tap from completing the car outright
  s.pits[0].playerPresent = false;
  tapRepair(s, 0);
  assert.equal(s.pits[0].car.ticksDone, 0);
  s.pits[0].playerPresent = true;
  tapRepair(s, 0);
  assert.equal(s.pits[0].car.ticksDone, settings.repair.tapTicks);
});

check('finishing a car parks its payout at the pit, collected on the next tick', () => {
  const s = createInitialState();
  s.permanentReputation = 0; // rusty car → routes to pit 0
  tick(s, settings.spawn.interval);
  s.pits[0].playerPresent = true;
  const car = s.pits[0].car;
  const expectedTaps = Math.ceil(requiredTicks(car, s.pits[0]) / settings.repair.tapTicks);
  let taps = 0;
  while (s.pits[0].car === car && taps < 1000) {
    tapRepair(s, 0);
    taps += 1;
  }
  assert.equal(taps, expectedTaps);
  assert.equal(s.pits[0].car, null);
  // No cashier: the pay waits at the pit, not yet in cash.
  assert.equal(s.cash, 0);
  assert.equal(s.pits[0].pendingCash, car.payout);
  // Player is standing here, so the next tick banks it.
  tick(s, 0);
  assert.equal(s.cash, car.payout);
  assert.equal(s.pits[0].pendingCash, 0);
});

check('full flow: fix several cars, cash accrues by each payout (collected at the pit)', () => {
  const s = createInitialState();
  s.permanentReputation = 0; // every car is rusty → routes to pit 0
  s.pits[0].playerPresent = true; // player stands here, so each tick banks waiting pay
  let expected = 0;
  for (let r = 0; r < 5; r++) {
    tick(s, settings.spawn.interval); // ensure a car is present (and bank prior round's pay)
    const car = s.pits[0].car;
    if (!car) continue;
    expected += car.payout;
    while (s.pits[0].car === car) tapRepair(s, 0);
  }
  tick(s, 0); // bank the final round's pay
  assert.equal(s.cash, expected);
  assert.equal(s.pits[0].pendingCash, 0);
  assert.ok(expected > 0);
});

// --- two-stage room unlock ------------------------------------------------
console.log('\ncore room unlock (expand + equip)');

check('buyExpandRoom unlocks the next lot only (not equipped)', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = settings.reputation.repCap;
  assert.equal(buyExpandRoom(s), true);
  assert.equal(s.pits[1].roomUnlocked, true);
  assert.equal(s.pits[1].equipped, false);
});

check('expand fails without cash and leaves lot locked', () => {
  const s = createInitialState();
  s.permanentReputation = settings.reputation.repCap; // isolate the cash gate
  s.cash = 0;
  assert.equal(buyExpandRoom(s), false);
  assert.equal(s.pits[1].roomUnlocked, false);
});

check('buyPitEquipment needs a roomUnlocked lot, then equips it', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = settings.reputation.repCap;
  assert.equal(buyPitEquipment(s, 1), false); // not roomUnlocked yet
  buyExpandRoom(s);
  assert.equal(buyPitEquipment(s, 1), true);
  assert.equal(s.pits[1].equipped, true);
});

check('a freshly equipped pit starts accepting cars', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = settings.reputation.repCap; // clear the rep gate for the buy
  buyExpandRoom(s);
  buyPitEquipment(s, 1);
  s.permanentReputation = 0.25; // 50% rusty (→ pit 0), 50% normal (→ pit 1)
  for (let i = 0; i < 50; i++) tick(s, settings.spawn.interval);
  assert.ok(s.pits[0].car);
  assert.ok(s.pits[1].car); // second pit now pulls from its own queue
});

check('expand cost grows geometrically per opened lot', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = settings.reputation.repCap;
  const c0 = expandRoomCost(s);
  buyExpandRoom(s);
  const c1 = expandRoomCost(s);
  assert.ok(c1 > c0);
  assert.equal(c1, Math.round(c0 * settings.upgrades.expandRoom.costGrowth));
});

check('pit equipment cost scales with pit index', () => {
  const s = createInitialState();
  assert.ok(pitEquipmentCost(s, 2) > pitEquipmentCost(s, 1));
});

check('expand is reputation-gated: cash alone cannot open a rep-gated lot', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = settings.pit.unlockReputation[1] - 0.01; // just under lot B's gate
  assert.equal(buyExpandRoom(s), false, 'blocked by reputation despite ample cash');
  assert.equal(s.pits[1].roomUnlocked, false);
  assert.equal(s.cash, 1e9, 'nothing charged');
});

check('reputation alone does not unlock a lot — the cash cost still applies', () => {
  const s = createInitialState();
  s.permanentReputation = settings.reputation.repCap;
  s.cash = 0;
  assert.equal(buyExpandRoom(s), false, 'reputation alone never unlocks');
  assert.equal(s.pits[1].roomUnlocked, false);
  s.cash = expandRoomCost(s);
  assert.equal(buyExpandRoom(s), true, 'both requirements met → unlocked');
  assert.equal(s.pits[1].roomUnlocked, true);
});

check('each lot enforces its own reputation threshold (10/30/50/70%)', () => {
  assert.deepEqual(settings.pit.unlockReputation, [0, 0.1, 0.3, 0.5, 0.7]);
  const s = createInitialState();
  s.cash = 1e9;
  for (let i = 1; i < settings.maxPits; i++) {
    s.permanentReputation = settings.pit.unlockReputation[i] - 0.01;
    assert.equal(buyExpandRoom(s), false, `lot ${i} blocked just under its threshold`);
    s.permanentReputation = settings.pit.unlockReputation[i];
    assert.equal(buyExpandRoom(s), true, `lot ${i} opens at its threshold`);
  }
});

check('a reputation gate is checked against permanent rep only', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = 0.05; // under lot B's 10% gate
  assert.equal(buyExpandRoom(s), false, 'under-threshold reputation never opens land');
});

// --- per-pit upgrades -----------------------------------------------------
console.log('\ncore per-pit upgrades');

check('hireMechanic requires an equipped pit', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = settings.reputation.repCap;
  buyExpandRoom(s); // pit 1 roomUnlocked but not equipped
  assert.equal(hireMechanic(s, 1), false);
  buyPitEquipment(s, 1);
  assert.equal(hireMechanic(s, 1), true);
  assert.equal(s.pits[1].hasMechanic, true);
});

check('worker speed raises only its own pit rate', () => {
  const s = createInitialState();
  s.cash = 1e9;
  const r0 = workerSpeed(s.pits[0]);
  assert.equal(buyWorkerSpeed(s, 0), false, 'gated until the mechanic is hired');
  hireMechanic(s, 0);
  assert.equal(buyWorkerSpeed(s, 0), true);
  assert.ok(workerSpeed(s.pits[0]) > r0);
  assert.equal(workerSpeed(s.pits[1]), r0); // untouched
});

check('fixing time lowers required ticks for its own pit (with a floor)', () => {
  const s = createInitialState();
  s.cash = 1e9;
  const car = { baseTicks: settings.repair.ticksPerPart * 3 };
  const before = requiredTicks(car, s.pits[0]);
  assert.equal(buyFixingTime(s, 0), false, 'gated until the mechanic is hired');
  hireMechanic(s, 0);
  buyFixingTime(s, 0);
  assert.ok(requiredTicks(car, s.pits[0]) < before);
  for (let i = 0; i < 50; i++) buyFixingTime(s, 0); // hit max
  assert.ok(fixTimeFactor(s.pits[0]) >= settings.upgrades.fixingTime.factorFloor - 1e-9);
});

check('upgrade cost grows with level', () => {
  const s = createInitialState();
  s.cash = 1e9;
  hireMechanic(s, 0);
  const c0 = settings.upgrades.fixingTime.baseCost;
  buyFixingTime(s, 0);
  const before = s.cash;
  buyFixingTime(s, 0);
  assert.equal(before - s.cash, Math.round(c0 * settings.upgrades.fixingTime.costGrowth));
});

// --- worker + hurry -------------------------------------------------------
console.log('\ncore worker + hurry');

check('a hired worker auto-repairs; with no cashier the pay waits at the pit', () => {
  const s = createInitialState();
  s.cash = 1e9;
  hireMechanic(s, 0);
  s.cash = 0; // isolate earnings; the player is never near a pit
  for (let i = 0; i < 1500; i++) tick(s, 0.016); // ~24s, no input, no taps
  assert.equal(s.cash, 0, 'nothing banked without a cashier or the player nearby');
  assert.ok(s.pits[0].pendingCash > 0, 'worker pay piles up at the pit');
  // Walk up: the next tick banks everything waiting there.
  const waiting = s.pits[0].pendingCash;
  s.pits[0].playerPresent = true;
  tick(s, 0.016);
  assert.ok(s.cash >= waiting, 'walking up collects the waiting pay');
  assert.equal(s.pits[0].pendingCash, 0);
});

check('pre-worker, an unmanned pit does NOT repair on its own', () => {
  const s = createInitialState();
  s.permanentReputation = 0; // rusty car → routes to pit 0
  tick(s, settings.spawn.interval); // car arrives in pit 0
  const car = s.pits[0].car;
  const before = car.ticksDone;
  for (let i = 0; i < 600; i++) tick(s, 0.016); // ~10s, no worker, no taps
  if (s.pits[0].car === car) assert.equal(s.pits[0].car.ticksDone, before);
});

check('hurry only works on a manned pit and multiplies the work rate', () => {
  // no worker -> no-op
  const s0 = createInitialState();
  hurry(s0, 0);
  assert.equal(s0.pits[0].hurryTimer, 0);

  // controlled pit car big enough not to finish in one step
  const make = () => {
    const s = createInitialState();
    s.cash = 1e9;
    hireMechanic(s, 0);
    s.pits[0].car = { id: 999, baseTicks: 1e6, ticksDone: 0, damageParts: ['tire'], payout: 5, fixed: false };
    return s;
  };
  const base = make();
  tick(base, 0.1);
  const baseWork = base.pits[0].car.ticksDone;

  const fast = make();
  hurry(fast, 0);
  assert.ok(fast.pits[0].hurryTimer > 0);
  tick(fast, 0.1);
  const fastWork = fast.pits[0].car.ticksDone;

  assert.ok(fastWork > baseWork);
  assert.ok(Math.abs(fastWork / baseWork - settings.hurry.multiplier) < 0.05);
});

check('hurry is per-pit: hurrying one pit does not boost another', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = settings.reputation.repCap;
  buyExpandRoom(s);
  buyPitEquipment(s, 1);
  hireMechanic(s, 0);
  hireMechanic(s, 1);
  hurry(s, 0);
  assert.ok(s.pits[0].hurryTimer > 0);
  assert.equal(s.pits[1].hurryTimer, 0);
});

// --- payout collection: pending vs cashier --------------------------------
console.log('\ncore payout collection');

check('initial state: no cashier, no pit holds waiting pay', () => {
  const s = createInitialState();
  assert.equal(s.hasCashier, false);
  for (const pit of s.pits) assert.equal(pit.pendingCash, 0);
});

check('no cashier: pay waits at the pit, banked only when the player is near', () => {
  const s = createInitialState();
  s.permanentReputation = 0; // rusty car → routes to pit 0
  tick(s, settings.spawn.interval);
  const car = s.pits[0].car;
  s.pits[0].playerPresent = true; // present so we can tap-repair to completion
  while (s.pits[0].car === car) tapRepair(s, 0);
  assert.equal(s.pits[0].pendingCash, car.payout);
  assert.equal(s.cash, 0);

  // Player walks away: a tick does NOT bank the waiting pay.
  s.pits[0].playerPresent = false;
  tick(s, 0);
  assert.equal(s.cash, 0);
  assert.equal(s.pits[0].pendingCash, car.payout);

  // Player comes back: it's collected on proximity.
  s.pits[0].playerPresent = true;
  tick(s, 0);
  assert.equal(s.cash, car.payout);
  assert.equal(s.pits[0].pendingCash, 0);
});

check('a pit keeps accepting and repairing the next car while pay is waiting', () => {
  const s = createInitialState();
  s.cash = 1e9;
  hireMechanic(s, 0);
  s.pits[0].pendingCash = 500; // money already waiting, uncollected
  s.pits[0].playerPresent = false; // nobody to collect it
  const car = spawnCar(s);
  car.baseTicks = 1e6; // keep the whole 1s tick from completing the car outright
  s.pits[0].car = car;
  tick(s, 1); // worker makes progress on the new car
  assert.ok(s.pits[0].car && s.pits[0].car.ticksDone > 0, 'repair proceeds despite waiting pay');
  assert.equal(s.pits[0].pendingCash, 500, 'waiting pay is untouched while uncollected');
});

check('cashier: every payout banks straight to cash, nothing waits at any pit', () => {
  const s = createInitialState();
  s.cash = 1e9;
  assert.equal(buyCashier(s), true);
  hireMechanic(s, 0);
  const before = s.cash;
  for (let i = 0; i < 2000; i++) tick(s, 0.016); // player never near a pit
  assert.ok(s.cash > before, 'cashier banks payouts hands-free');
  for (const pit of s.pits) assert.equal(pit.pendingCash, 0, 'nothing waits at any pit');
});

check('hiring the cashier sweeps already-waiting pit pay into cash (one-time)', () => {
  const s = createInitialState();
  const cost = cashierCost(s);
  s.cash = 100 + cost;
  s.pits[0].pendingCash = 30;
  assert.equal(buyCashier(s), true);
  assert.equal(s.hasCashier, true);
  assert.equal(s.cash, 100 + 30, 'cost paid, waiting pay swept in');
  assert.equal(s.pits[0].pendingCash, 0);
  assert.equal(buyCashier(s), false, 'cashier is a one-time hire');
});

// --- tire storage + auto-restock ------------------------------------------
console.log('\ncore tire storage + auto-restock');

check('initial state: each pit starts with a full tire stack and a full shelf', () => {
  const s = createInitialState();
  for (const pit of s.pits) {
    assert.equal(pit.tiresRemaining, settings.storage.maxTiresPerPit);
    assert.equal(pit.shelfBoxes, settings.storage.shelfCapacity);
  }
  assert.equal(s.player.carryingBox, false);
  assert.equal(s.player.carryingBoxPitIndex, null);
  assert.equal(s.autoRestock, false);
});

check('each completed repair burns exactly one tire', () => {
  const s = createInitialState();
  s.permanentReputation = 0; // rusty → pit 0
  tick(s, settings.spawn.interval);
  s.pits[0].playerPresent = true;
  const before = s.pits[0].tiresRemaining;
  const car = s.pits[0].car;
  while (s.pits[0].car === car) tapRepair(s, 0);
  assert.equal(s.pits[0].tiresRemaining, before - 1);
});

check('a pit out of tires stops accepting + pulling cars, and resumes when refilled', () => {
  const s = createInitialState();
  s.permanentReputation = 0; // rusty → pit 0
  s.pits[0].tiresRemaining = 0;
  s.pits[0].shelfBoxes = 0; // no auto path to refill
  for (let i = 0; i < 40; i++) tick(s, settings.spawn.interval);
  assert.equal(s.pits[0].car, null, 'no car pulled while out of tires');
  assert.equal(s.pits[0].queue.length, 0, 'no cars accepted into the queue either');

  // Refill the stack: intake resumes.
  s.pits[0].tiresRemaining = settings.storage.maxTiresPerPit;
  for (let i = 0; i < 10; i++) tick(s, settings.spawn.interval);
  assert.ok(s.pits[0].car || s.pits[0].queue.length > 0, 'cars flow again once refilled');
});

check('player picks up a box at the shelf and delivers it to the worker to refill tires', () => {
  const s = createInitialState();
  const pit = s.pits[0];
  pit.tiresRemaining = 4; // partly depleted
  const boxesBefore = pit.shelfBoxes;

  // Standing at the shelf grabs one box (carry state set; shelf stock is infinite
  // + decorative, so the count is untouched).
  pit.playerNearShelf = true;
  tick(s, 0);
  assert.equal(s.player.carryingBox, true);
  assert.equal(s.player.carryingBoxPitIndex, 0);
  assert.equal(pit.shelfBoxes, boxesBefore);

  // Carrying, but only near the shelf again → no second pickup (already holding).
  tick(s, 0);
  assert.equal(pit.shelfBoxes, boxesBefore);

  // Walk to the worker: the box is delivered and the stack is refilled to full.
  pit.playerNearShelf = false;
  pit.playerPresent = true;
  tick(s, 0);
  assert.equal(s.player.carryingBox, false);
  assert.equal(s.player.carryingBoxPitIndex, null);
  assert.equal(pit.tiresRemaining, settings.storage.maxTiresPerPit);
});

check('a box only delivers to the pit it was taken from', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = settings.reputation.repCap;
  buyExpandRoom(s);
  buyPitEquipment(s, 1); // pit 1 equipped too
  s.pits[1].tiresRemaining = 2;

  // Take a box from pit 0's shelf.
  s.pits[0].playerNearShelf = true;
  tick(s, 0);
  assert.equal(s.player.carryingBoxPitIndex, 0);

  // Standing at pit 1's worker must NOT deliver pit 0's box.
  s.pits[0].playerNearShelf = false;
  s.pits[1].playerPresent = true;
  tick(s, 0);
  assert.equal(s.player.carryingBox, true, 'still carrying — wrong pit');
  assert.equal(s.pits[1].tiresRemaining, 2, 'wrong pit not refilled');
});

check('auto-restock upgrade: one-time purchase, gated on cash AND the cashier hire', () => {
  const s = createInitialState();
  s.cash = autoRestockCost(s);
  assert.equal(buyAutoRestock(s), false, 'locked until the cashier is hired, even with the cash');
  s.hasCashier = true;
  s.cash = 0;
  assert.equal(buyAutoRestock(s), false, "can't afford yet");
  s.cash = autoRestockCost(s);
  assert.equal(buyAutoRestock(s), true);
  assert.equal(s.autoRestock, true);
  assert.equal(buyAutoRestock(s), false, 'one-time purchase');
});

check("with auto-restock owned, a pit's mechanic fetches a box and refills its own tires", () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.hasCashier = true; // auto-restock is cashier-gated
  hireMechanic(s, 0);
  buyAutoRestock(s);
  s.pits[0].tiresRemaining = 0; // run the pit dry
  // The mechanic walks to its own shelf, picks up a box, carries it back, and restocks.
  for (let i = 0; i < 4000 && s.pits[0].tiresRemaining === 0; i++) tick(s, 0.05);
  assert.ok(s.pits[0].tiresRemaining > 0, 'the mechanic restocked its own pit, hands-free');
});

check('without auto-restock, the mechanic does NOT refill — the pit waits for the player', () => {
  const s = createInitialState();
  s.cash = 1e9;
  hireMechanic(s, 0);
  s.pits[0].tiresRemaining = 0;
  for (let i = 0; i < 400; i++) tick(s, 0.05);
  assert.equal(s.pits[0].tiresRemaining, 0, 'no auto-restock without the upgrade');
});

// --- reputation + advertising ----------------------------------------------
console.log('\ncore reputation + advertising');

check('initial state: reputation starts at baseReputation, no ad cooldown, no ad purchases', () => {
  const s = createInitialState();
  assert.equal(s.permanentReputation, settings.reputation.baseReputation);
  assert.equal(s.adCooldownRemaining, 0);
  assert.equal(s.adLevel, 0);
});

check('getEffectiveReputation: returns permanent rate, clamped to repCap', () => {
  const s = createInitialState();
  assert.equal(getEffectiveReputation(s), settings.reputation.baseReputation);

  s.permanentReputation = 1.5; // over repCap (1.0)
  assert.equal(getEffectiveReputation(s), settings.reputation.repCap);
});

check('tierWeights: reputation unlocks tiers linearly with the exact key-value distribution', () => {
  const approx = (a, b) => Math.abs(a - b) < 1e-9;
  const expect = (rep, active) => {
    const w = tierWeights(rep);
    assert.equal(w.length, settings.carTiers.length);
    active.forEach((share, i) => assert.ok(approx(w[i], share), `rep ${rep} tier ${i}: ${w[i]} != ${share}`));
    for (let i = active.length; i < w.length; i++) assert.ok(approx(w[i], 0), `rep ${rep} tier ${i} should be 0`);
    assert.ok(approx(w.reduce((a, x) => a + x, 0), 1), `rep ${rep} weights must sum to 1`);
  };

  expect(0.0, [1]); // rusty 100%
  expect(0.25, [0.5, 0.5]); // rusty/normal
  expect(0.5, [1 / 3, 1 / 3, 1 / 3]); // rusty/normal/decent
  expect(0.75, [0.25, 0.25, 0.25, 0.25]); // + premium
  expect(1.0, [0.2, 0.2, 0.2, 0.2, 0.2]); // all five
  expect(0.125, [0.75, 0.25]); // mid-ramp: normal interpolating in
});

check('spawnCar: at max reputation every tier appears, each scaled by its own ticksMult/payoutMult', () => {
  const s = createInitialState();
  s.permanentReputation = settings.reputation.repCap;
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const car = spawnCar(s);
    const n = car.damageParts.length;
    const tier = settings.carTiers.find((t) => t.name === car.tier);
    assert.ok(tier, `unknown tier ${car.tier}`);
    assert.ok(Math.abs(car.baseTicks - settings.repair.ticksPerPart * n * tier.ticksMult) < 1e-9);
    assert.ok(Math.abs(car.payout - settings.spawn.basePayoutPerPart * n * tier.payoutMult) < 1e-9);
    seen.add(car.tier);
  }
  assert.equal(seen.size, settings.carTiers.length); // uniform roll hits all five tiers
});

check('buyAdvertising: deducts cost, adds repStep, bumps adLevel; fails when unaffordable', () => {
  const s = createInitialState();
  s.cash = 0;
  assert.equal(buyAdvertising(s), false);
  assert.equal(s.permanentReputation, settings.reputation.baseReputation);

  s.cash = 1e9;
  const before = s.permanentReputation;
  const cost = adCost(s);
  assert.equal(buyAdvertising(s), true);
  assert.equal(s.cash, 1e9 - cost);
  assert.ok(Math.abs(s.permanentReputation - (before + settings.reputation.repStep)) < 1e-9);
  assert.equal(s.adLevel, 1);
});

check('adCost grows geometrically with adLevel', () => {
  const s = createInitialState();
  s.cash = 1e9;
  const c0 = adCost(s);
  buyAdvertising(s);
  const c1 = adCost(s);
  assert.ok(c1 > c0);
  assert.equal(c1, Math.round(c0 * settings.reputation.adGrowth));
});

check('buyAdvertising refuses once reputation is already at repCap', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = settings.reputation.repCap;
  assert.equal(buyAdvertising(s), false);
  assert.equal(s.permanentReputation, settings.reputation.repCap);
});

check('watchAdForReputation grants a permanent +adRewardStep and arms the cooldown', () => {
  const s = createInitialState();
  const before = s.permanentReputation;
  assert.equal(watchAdForReputation(s), true);
  assert.ok(Math.abs(s.permanentReputation - (before + settings.reputation.adRewardStep)) < 1e-9);
  assert.equal(s.adCooldownRemaining, settings.reputation.adCooldownSeconds);
});

check('watchAdForReputation refuses while on cooldown (no free rep until it elapses)', () => {
  const s = createInitialState();
  watchAdForReputation(s);
  const rep = s.permanentReputation;
  assert.equal(watchAdForReputation(s), false); // still cooling down
  assert.equal(s.permanentReputation, rep);

  tick(s, 10); // partway through the cooldown
  assert.ok(s.adCooldownRemaining < settings.reputation.adCooldownSeconds);
  assert.equal(watchAdForReputation(s), false);
});

check('watchAdForReputation refuses once reputation is already at repCap', () => {
  const s = createInitialState();
  s.permanentReputation = settings.reputation.repCap;
  assert.equal(watchAdForReputation(s), false);
  assert.equal(s.adCooldownRemaining, 0); // no cooldown consumed on a refusal
});

check('tick decrements adCooldownRemaining toward 0 and never goes negative', () => {
  const s = createInitialState();
  watchAdForReputation(s);
  const steps = Math.ceil(settings.reputation.adCooldownSeconds) + 5; // run past the full cooldown
  for (let i = 0; i < steps; i++) tick(s, 1);
  assert.equal(s.adCooldownRemaining, 0);

  // cooldown elapsed → another free watch is allowed
  assert.equal(watchAdForReputation(s), true);
});

// --- number formatting -------------------------------------------------------
console.log('\ncore number formatting');

check('formatMoney: plain integers under 1000, no suffix', () => {
  assert.equal(formatMoney(0), '0');
  assert.equal(formatMoney(1), '1');
  assert.equal(formatMoney(999), '999');
});

check('formatMoney: K/M/B/T at 3 significant figures', () => {
  assert.equal(formatMoney(12000), '12.0K');
  assert.equal(formatMoney(1543200), '1.54M');
  assert.equal(formatMoney(2_500_000_000), '2.50B');
  assert.equal(formatMoney(7_000_000_000_000), '7.00T');
});

check('formatMoney: rounding never leaves a stray "1000" in the old unit', () => {
  assert.equal(formatMoney(999996), '1.00M'); // would mis-round to "1000K" without the bump
});

check('formatMoney: negative numbers keep the sign', () => {
  assert.equal(formatMoney(-12000), '-12.0K');
});

// --- supermarket ------------------------------------------------------------
console.log('\ncore supermarket');

check('initial state: locked, 4 full shelves, no customers, no worker', () => {
  const s = createInitialState();
  assert.equal(s.supermarket.unlocked, false);
  assert.equal(s.supermarket.workerLevel, 0);
  assert.equal(s.supermarket.shelves.length, settings.supermarket.shelves.length);
  for (const shelf of s.supermarket.shelves) assert.equal(shelf.stock, settings.supermarket.shelfCapacity);
  assert.equal(s.supermarket.customerQueue.length, 0);
  assert.equal(s.supermarket.checkoutBag, null);
  assert.equal(s.supermarket.worker, null);
});

check('tickSupermarket does nothing until the supermarket is unlocked', () => {
  const s = createInitialState();
  for (let i = 0; i < 200; i++) tickSupermarket(s, 1);
  assert.equal(s.supermarket.customerQueue.length, 0);
});

check('spawnCustomer: 1-5 items, only known product types, pushed as walkingIn', () => {
  const s = createInitialState();
  for (let i = 0; i < 200; i++) {
    const before = s.supermarket.customerQueue.length;
    const c = spawnCustomer(s);
    const total = Object.values(c.request).reduce((a, n) => a + n, 0);
    assert.ok(total >= settings.supermarket.customerMinItems && total <= settings.supermarket.customerMaxItems);
    for (const type in c.request) assert.ok(type in settings.supermarket.products);
    assert.equal(c.state, 'walkingIn');
    assert.equal(s.supermarket.customerQueue.length, before + 1);
  }
});

check('once unlocked, customers spawn automatically up to maxCustomerQueue', () => {
  const s = createInitialState();
  s.supermarket.unlocked = true;
  for (let i = 0; i < 500; i++) tickSupermarket(s, settings.supermarket.customerSpawnInterval);
  assert.equal(s.supermarket.customerQueue.length, settings.supermarket.maxCustomerQueue);
});

check('computeTotal sums price x quantity per product', () => {
  const P = settings.supermarket.products;
  assert.equal(computeTotal({ A: 2, D: 1 }), P.A.price * 2 + P.D.price * 1);
});

check('frontCustomer is null when nobody has fully walked in yet', () => {
  const s = createInitialState();
  assert.equal(frontCustomer(s), null);
  s.supermarket.customerQueue.push({ id: 1, request: {}, state: 'walkingIn', position: { x: 0, z: 0 }, rotation: 0, moving: true });
  assert.equal(frontCustomer(s), null);
});

check("buyProduct gathers exactly what's needed (capped by stock); placeAtCheckout needs a complete bag", () => {
  const s = createInitialState();
  const customer = { id: 1, request: { A: 2, C: 1 }, state: 'waiting', position: { x: 0, z: 0 }, rotation: 0, moving: false };
  s.supermarket.customerQueue.push(customer);

  assert.equal(placeAtCheckout(s), false, 'nothing gathered yet');

  const shelfOf = (type) => s.supermarket.shelves.findIndex((sh) => sh.productType === type);

  assert.equal(buyProduct(s, shelfOf('B')), false, 'order has no B');
  assert.equal(buyProduct(s, shelfOf('A')), true);
  assert.equal(s.supermarket.shelves[shelfOf('A')].stock, settings.supermarket.shelfCapacity - 2, 'took both needed A at once');
  assert.equal(buyProduct(s, shelfOf('A')), false, 'already has all the A it needs');

  assert.equal(placeAtCheckout(s), false, 'still missing C');

  assert.equal(buyProduct(s, shelfOf('C')), true);
  assert.equal(placeAtCheckout(s), true);
  assert.equal(s.supermarket.assemblingBag, null);
  assert.deepEqual(s.supermarket.checkoutBag.items, { A: 2, C: 1 });
  assert.equal(s.supermarket.checkoutBag.total, computeTotal({ A: 2, C: 1 }));
  assert.equal(placeAtCheckout(s), false, 'counter already occupied');
});

check("buyProduct is capped by the shelf's remaining stock", () => {
  const s = createInitialState();
  const customer = { id: 1, request: { A: 5 }, state: 'waiting', position: { x: 0, z: 0 }, rotation: 0, moving: false };
  s.supermarket.customerQueue.push(customer);
  const shelfA = s.supermarket.shelves.findIndex((sh) => sh.productType === 'A');
  s.supermarket.shelves[shelfA].stock = 2;
  assert.equal(buyProduct(s, shelfA), true);
  assert.equal(s.supermarket.shelves[shelfA].stock, 0);
  assert.equal(s.supermarket.assemblingBag.items.A, 2);
  assert.equal(buyProduct(s, shelfA), false, 'shelf empty, even though the order still needs 3 more');
});

check('checkoutCustomer pays into cash and starts the customer walking out', () => {
  const s = createInitialState();
  const customer = { id: 1, request: { D: 1 }, state: 'waiting', position: { x: 0, z: 0 }, rotation: 0, moving: false };
  s.supermarket.customerQueue.push(customer);
  buyProduct(s, s.supermarket.shelves.findIndex((sh) => sh.productType === 'D'));
  placeAtCheckout(s);
  const total = s.supermarket.checkoutBag.total;

  assert.equal(checkoutCustomer(s), true);
  assert.equal(s.cash, total);
  assert.equal(customer.state, 'walkingOut');
  assert.equal(s.supermarket.checkoutBag, null);
});

check('a served customer walks to checkout, pays, walks out, and is removed from the queue', () => {
  const s = createInitialState();
  s.supermarket.unlocked = true;
  s.supermarket.spawnTimer = -1e9; // no auto-spawned customers during this test
  const customer = spawnCustomer(s);

  for (let i = 0; i < 200 && customer.state === 'walkingIn'; i++) tickSupermarket(s, 0.5);
  assert.equal(customer.state, 'waiting');

  for (const type in customer.request) {
    buyProduct(s, s.supermarket.shelves.findIndex((sh) => sh.productType === type));
  }
  assert.equal(placeAtCheckout(s), true);

  const before = s.cash;
  for (let i = 0; i < 200 && s.supermarket.customerQueue.includes(customer); i++) tickSupermarket(s, 0.5);
  assert.ok(!s.supermarket.customerQueue.includes(customer), 'customer eventually leaves');
  assert.ok(s.cash > before, 'payment landed in cash');
});

check('restockShelf refills to capacity; no-ops once already full or for a bad index', () => {
  const s = createInitialState();
  const shelf = s.supermarket.shelves[0];
  shelf.stock = 3;
  assert.equal(restockShelf(s, 0), true);
  assert.equal(shelf.stock, settings.supermarket.shelfCapacity);
  assert.equal(restockShelf(s, 0), false, 'already full');
  assert.equal(restockShelf(s, 99), false, 'bad index');
});

check('buySupermarket: one-time, deducts cost, gated on cash', () => {
  const s = createInitialState();
  assert.equal(buySupermarket(s), false, 'no cash yet');
  s.cash = supermarketCost(s);
  assert.equal(buySupermarket(s), true);
  assert.equal(s.supermarket.unlocked, true);
  assert.equal(s.cash, 0);
  assert.equal(buySupermarket(s), false, 'one-time purchase');
});

check('hireMarketWorker requires the supermarket open AND the cashier hired, then spawns a worker', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.hasCashier = true;
  assert.equal(hireMarketWorker(s), false, 'market not open yet');
  buySupermarket(s);
  s.hasCashier = false;
  assert.equal(hireMarketWorker(s), false, 'locked until the cashier is hired');
  s.hasCashier = true;
  assert.equal(hireMarketWorker(s), true);
  assert.equal(s.supermarket.workerLevel, 1);
  assert.ok(s.supermarket.worker);
  assert.equal(hireMarketWorker(s), false, 'one-time hire');
});

check('trainMarketWorker requires a level-1 worker first (and the cashier)', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.hasCashier = true;
  assert.equal(trainMarketWorker(s), false, 'no worker yet');
  buySupermarket(s);
  hireMarketWorker(s);
  s.hasCashier = false;
  assert.equal(trainMarketWorker(s), false, 'locked until the cashier is hired');
  s.hasCashier = true;
  assert.equal(trainMarketWorker(s), true);
  assert.equal(s.supermarket.workerLevel, 2);
  assert.equal(trainMarketWorker(s), false, 'one-time train');
});

check("a level-1 worker auto-packages a waiting customer's order with no manual taps", () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.hasCashier = true; // market upgrades are cashier-gated
  buySupermarket(s);
  hireMarketWorker(s);
  s.supermarket.spawnTimer = -1e9; // isolate this customer from auto-spawning
  const customer = { id: 1, request: { A: 1, B: 2 }, state: 'waiting', position: { x: -34, z: -1.5 }, rotation: 0, moving: false };
  s.supermarket.customerQueue.push(customer);

  for (let i = 0; i < 2000 && customer.state === 'waiting'; i++) tickSupermarket(s, 0.1);
  assert.equal(customer.state, 'walkingToCheckout', 'worker placed the bag without any manual taps');
});

check('a level-2 worker auto-restocks the emptiest shelf when no one needs packaging', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.hasCashier = true; // market upgrades are cashier-gated
  buySupermarket(s);
  hireMarketWorker(s);
  trainMarketWorker(s);
  s.supermarket.spawnTimer = -1e9; // no customers — isolate restocking
  s.supermarket.shelves[2].stock = 0;

  for (let i = 0; i < 2000 && s.supermarket.shelves[2].stock < settings.supermarket.shelfCapacity; i++) {
    tickSupermarket(s, 0.1);
  }
  assert.equal(s.supermarket.shelves[2].stock, settings.supermarket.shelfCapacity, 'worker refilled it hands-free');
});

check('a level-1 worker does NOT restock — that still needs the player until trained', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.hasCashier = true; // market upgrades are cashier-gated
  buySupermarket(s);
  hireMarketWorker(s);
  s.supermarket.spawnTimer = -1e9;
  s.supermarket.shelves[1].stock = 0;
  for (let i = 0; i < 200; i++) tickSupermarket(s, 0.1);
  assert.equal(s.supermarket.shelves[1].stock, 0, 'untrained worker leaves restocking alone');
});

// --- restock box + delivery truck -------------------------------------------
console.log('\ncore restock box + truck');

check('restock box starts full at maxUnits', () => {
  const s = createInitialState();
  const max = settings.supermarket.restockBox.maxUnits;
  assert.equal(s.supermarket.restockBox.maxUnits, max);
  assert.equal(s.supermarket.restockBox.units, max);
});

check('takeRestockUnit decrements until empty, then returns false', () => {
  const s = createInitialState();
  const max = settings.supermarket.restockBox.maxUnits;
  for (let i = 0; i < max; i++) assert.equal(takeRestockUnit(s), true);
  assert.equal(s.supermarket.restockBox.units, 0);
  assert.equal(takeRestockUnit(s), false, 'empty box yields nothing');
  assert.equal(s.supermarket.restockBox.units, 0, 'never goes negative');
});

check('truckDeliveryTime follows the upgrade level', () => {
  const s = createInitialState();
  const times = settings.supermarket.truck.deliveryTimes;
  assert.equal(truckDeliveryTime(s), times[0]);
  s.supermarket.truckUpgradeLevel = 2;
  assert.equal(truckDeliveryTime(s), times[2]);
});

check('the truck is idle until ordered: tickTruck never dispatches on its own', () => {
  const s = createInitialState();
  s.supermarket.unlocked = true;
  s.supermarket.restockBox.units = 0; // empty box alone is not enough below max level
  tickTruck(s, truckDeliveryTime(s) * 10);
  assert.equal(s.supermarket.truckOrdered, false, 'no order placed itself');
  assert.equal(s.supermarket.truckArriving, false, 'no truck without an order');
  assert.equal(s.supermarket.truckTimer, 0, 'the clock only runs against an order');
});

check('orderTruck places an order; tickTruck dispatches after the delivery time; deliverStock refills', () => {
  const s = createInitialState();
  s.supermarket.unlocked = true;
  s.supermarket.restockBox.units = 0;

  assert.equal(orderTruck(s), true, 'order accepted');
  assert.equal(s.supermarket.truckOrdered, true);
  const time = truckDeliveryTime(s);

  tickTruck(s, time - 0.01);
  assert.equal(s.supermarket.truckArriving, false, 'not due yet');
  tickTruck(s, 0.02); // crosses the delivery time
  assert.equal(s.supermarket.truckArriving, true, 'truck dispatched');
  assert.equal(s.supermarket.truckOrdered, false, 'order consumed on dispatch');
  assert.equal(s.supermarket.truckTimer, 0, 'timer reset on dispatch');
  assert.equal(s.supermarket.restockBox.units, 0, 'box not filled until the truck lands');

  deliverStock(s);
  assert.equal(s.supermarket.restockBox.units, s.supermarket.restockBox.maxUnits, 'topped up to max');
  assert.equal(s.supermarket.truckArriving, false, 'arrival cleared');
});

check('orderTruck refuses duplicates, in-flight trucks, a full box, and a locked market', () => {
  const s = createInitialState();
  assert.equal(orderTruck(s), false, 'market not open yet');
  s.supermarket.unlocked = true;
  assert.equal(orderTruck(s), false, 'box already full — nothing to deliver');
  s.supermarket.restockBox.units = 0;
  assert.equal(orderTruck(s), true);
  assert.equal(orderTruck(s), false, 'an order is already pending');
  s.supermarket.truckOrdered = false;
  s.supermarket.truckArriving = true;
  assert.equal(orderTruck(s), false, 'a truck is already on its way');
});

check('tickTruck holds the clock while a truck is already in flight', () => {
  const s = createInitialState();
  s.supermarket.unlocked = true;
  s.supermarket.truckOrdered = true;
  s.supermarket.truckArriving = true;
  s.supermarket.truckTimer = 0;
  tickTruck(s, 100);
  assert.equal(s.supermarket.truckTimer, 0, 'no accrual mid-delivery');
});

check('at max Faster Deliveries level an order places itself the instant the box empties', () => {
  const maxLevel = settings.supermarket.truck.deliveryTimes.length - 1;

  const s = createInitialState();
  s.supermarket.unlocked = true;
  s.supermarket.truckUpgradeLevel = maxLevel;
  s.supermarket.restockBox.units = 0;
  tickTruck(s, 0.016);
  assert.equal(s.supermarket.truckOrdered, true, 'auto-ordered at max level');

  // One level below max: the empty box waits for the player instead.
  const below = createInitialState();
  below.supermarket.unlocked = true;
  below.supermarket.truckUpgradeLevel = maxLevel - 1;
  below.supermarket.restockBox.units = 0;
  tickTruck(below, 0.016);
  assert.equal(below.supermarket.truckOrdered, false, 'below max: waits for a manual order');
});

check('deliverStock never exceeds maxUnits', () => {
  const s = createInitialState();
  const max = settings.supermarket.restockBox.maxUnits;
  s.supermarket.restockBox.units = max - 1;
  deliverStock(s);
  assert.equal(s.supermarket.restockBox.units, max, 'tops up, never overfills');
});

check('callTruckEarly skips a placed order\'s wait so the next tick dispatches', () => {
  const s = createInitialState();
  s.supermarket.unlocked = true;
  s.supermarket.restockBox.units = 0;
  orderTruck(s);
  callTruckEarly(s);
  assert.equal(s.supermarket.truckArriving, false, 'not dispatched until the next tick');
  tickTruck(s, 0); // a zero-dt tick still sees timer >= delivery time
  assert.equal(s.supermarket.truckArriving, true, 'early call dispatched on the next tick');
});

check('callTruckEarly does nothing without a pending order', () => {
  const s = createInitialState();
  s.supermarket.unlocked = true;
  s.supermarket.restockBox.units = 0; // empty, but nothing ordered
  callTruckEarly(s);
  assert.equal(s.supermarket.truckTimer, 0, 'no order to hurry');
  tickTruck(s, 0);
  assert.equal(s.supermarket.truckArriving, false, 'still no truck without an order');
});

check('callTruckEarly is a no-op while a truck is already in flight', () => {
  const s = createInitialState();
  s.supermarket.unlocked = true;
  s.supermarket.truckOrdered = true;
  s.supermarket.truckArriving = true;
  s.supermarket.truckTimer = 5;
  callTruckEarly(s);
  assert.equal(s.supermarket.truckTimer, 5, 'left alone mid-delivery');
});

check('buyTruckFrequency steps the level with geometric cost, gated and capped', () => {
  const s = createInitialState();
  s.hasCashier = true;
  assert.equal(buyTruckFrequency(s), false, 'market not open yet');
  s.supermarket.unlocked = true;
  s.hasCashier = false;
  s.cash = 1e9;
  assert.equal(buyTruckFrequency(s), false, 'locked until the cashier is hired');
  s.hasCashier = true;
  s.cash = 0;

  const maxLevel = settings.supermarket.truck.deliveryTimes.length - 1;
  let prevCost = 0;
  for (let lvl = 0; lvl < maxLevel; lvl++) {
    const cost = truckFrequencyCost(s);
    assert.ok(cost > prevCost || lvl === 0, 'cost climbs geometrically');
    prevCost = cost;
    s.cash = cost;
    assert.equal(buyTruckFrequency(s), true);
    assert.equal(s.supermarket.truckUpgradeLevel, lvl + 1);
  }
  s.cash = 1e9;
  assert.equal(buyTruckFrequency(s), false, 'capped at the fastest level');
});

check('a level-2 worker waits while the box is empty, then restocks after a delivery', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.hasCashier = true; // market upgrades are cashier-gated
  buySupermarket(s);
  hireMarketWorker(s);
  trainMarketWorker(s);
  s.supermarket.spawnTimer = -1e9; // isolate restocking from customers
  s.supermarket.shelves[2].stock = 0;
  s.supermarket.restockBox.units = 0;

  // Nothing ordered (and below the auto-order level), so no truck ever comes on
  // its own — the empty box blocks restocking for as long as we let it run.
  const window = truckDeliveryTime(s) * 1.5;
  for (let t = 0; t < window; t += 0.1) tickSupermarket(s, 0.1);
  assert.equal(s.supermarket.shelves[2].stock, 0, 'no restock while the box is empty');
  assert.equal(s.supermarket.restockBox.units, 0, 'box still empty (nothing ordered)');

  // Stock the box and let the worker run: it restocks the empty shelf hands-free.
  deliverStock(s);
  for (let i = 0; i < 2000 && s.supermarket.shelves[2].stock < settings.supermarket.shelfCapacity; i++) {
    tickSupermarket(s, 0.1);
  }
  assert.equal(s.supermarket.shelves[2].stock, settings.supermarket.shelfCapacity, 'restocked once stock arrived');
  assert.ok(s.supermarket.restockBox.units < s.supermarket.restockBox.maxUnits, 'a unit was consumed for the refill');
});

// --- worker breaks ----------------------------------------------------------
console.log('\ncore worker breaks');

check('createBreakState: fresh counter, not on break', () => {
  const b = createBreakState('carMechanic');
  assert.equal(b.kind, 'carMechanic');
  assert.equal(b.jobCount, 0);
  assert.equal(b.onBreak, false);
  assert.equal(b.breakTimer, 0);
});

check('incrementJobCount trips a break at the threshold and zeroes the counter', () => {
  const b = createBreakState('carMechanic');
  const T = settings.breakThresholds.carMechanic;
  for (let i = 0; i < T - 1; i++) incrementJobCount(b);
  assert.equal(b.onBreak, false);
  assert.equal(b.jobCount, T - 1);
  incrementJobCount(b); // hits the threshold
  assert.equal(b.onBreak, true);
  assert.equal(b.jobCount, 0);
  incrementJobCount(b); // no accrual while already on break
  assert.equal(b.jobCount, 0);
});

check('tickBreak auto-ends the break after the full duration', () => {
  const b = createBreakState('marketWorker');
  b.onBreak = true;
  const dur = breakDuration(b);
  tickBreak(b, dur - 0.01);
  assert.equal(b.onBreak, true);
  assert.ok(breakRemaining(b) > 0);
  tickBreak(b, 0.02); // crosses the duration
  assert.equal(b.onBreak, false);
  assert.equal(b.breakTimer, 0);
  assert.equal(breakRemaining(b), 0);
});

check('endBreak clears the break and resets the counter (the rewarded-ad path)', () => {
  const b = createBreakState('carMechanic');
  b.onBreak = true;
  b.breakTimer = 3;
  b.jobCount = 0;
  endBreak(b);
  assert.equal(b.onBreak, false);
  assert.equal(b.breakTimer, 0);
  assert.equal(b.jobCount, 0);
});

check('a mechanic goes on break after breakThreshold repairs and stops auto-repairing', () => {
  const s = createInitialState();
  s.permanentReputation = 0; // rusty cars → pit 0
  s.cash = 1e9;
  hireMechanic(s, 0);
  s.pits[0].tiresRemaining = 1e9; // never run dry over the run

  let guard = 0;
  while (!s.pits[0].break.onBreak && guard < 200000) {
    tick(s, 0.05);
    guard += 1;
  }
  assert.equal(s.pits[0].break.onBreak, true, 'worker eventually takes a break');
  assert.equal(s.pits[0].break.jobCount, 0);

  // While seated, the car in the pit makes no repair progress.
  const car = s.pits[0].car;
  if (car) {
    const before = car.ticksDone;
    for (let i = 0; i < 50; i++) tick(s, 0.05); // 2.5s, well under the break duration
    if (s.pits[0].car === car) assert.equal(s.pits[0].car.ticksDone, before, 'no auto-repair while on break');
  }

  // Ending the break (ad reward) lets it work again: with no cashier and nobody
  // standing at the pit, finished-car pay parks at the pit (pendingCash), which
  // only ever grows here — so any progress proves the worker resumed repairing.
  endBreak(s.pits[0].break);
  s.pits[0].playerPresent = false;
  s.pits[0].pendingCash = 0;
  for (let i = 0; i < 4000; i++) tick(s, 0.05);
  assert.ok(s.pits[0].pendingCash > 0, 'work resumes (and pay accrues) after the break ends');
});

check('a manual-tap completion with no mechanic never accrues a break', () => {
  const s = createInitialState();
  s.permanentReputation = 0; // rusty → pit 0
  tick(s, settings.spawn.interval);
  s.pits[0].playerPresent = true;
  const car = s.pits[0].car;
  while (s.pits[0].car === car) tapRepair(s, 0);
  assert.equal(s.pits[0].break.jobCount, 0, 'no worker → no break counter movement');
  assert.equal(s.pits[0].break.onBreak, false);
});

check('the market worker accrues a break per checkout and eventually rests', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.hasCashier = true; // market upgrades are cashier-gated
  buySupermarket(s);
  hireMarketWorker(s);
  trainMarketWorker(s); // level 2: serves + restocks hands-free
  s.supermarket.restockBox.units = 1e9; // keep the box stocked so restocking never stalls this break test

  let guard = 0;
  while (!s.supermarket.worker.break.onBreak && guard < 300000) {
    tickSupermarket(s, 0.1);
    guard += 1;
  }
  assert.equal(s.supermarket.worker.break.onBreak, true, 'market worker eventually takes a break');
});

// --- gas station -------------------------------------------------------------
console.log('\ncore gas station');

// The station's first purchase is locked behind a fully built-out garage +
// market (see upgrades.gasStationPrereqs). Force-complete both directly on the
// state — the same style as setting permanentReputation — so gas tests can buy.
const completeGasPrereqs = (s) => {
  for (const pit of s.pits) {
    pit.roomUnlocked = true;
    pit.equipped = true;
    pit.hasMechanic = true;
    pit.workerSpeedLevel = settings.upgrades.workerSpeed.maxLevel;
    pit.fixingTimeLevel = settings.upgrades.fixingTime.maxLevel;
  }
  s.supermarket.unlocked = true;
  s.supermarket.workerLevel = 2;
  s.supermarket.truckUpgradeLevel = settings.supermarket.truck.deliveryTimes.length - 1;
};

// Unlock + equip a pump: unlike pit 0 there is no free starter pump, so every
// gas test that needs a working pump buys its way there first (cash restored after).
const openGasPump = (s, i = 0) => {
  const saved = s.cash;
  s.cash = 1e12;
  completeGasPrereqs(s); // the first expand is gated on the finished garage + market
  while (!s.gasStation.pumps[i].roomUnlocked) buyGasExpand(s);
  buyGasEquipment(s, i);
  s.cash = saved;
};

check('initial state: EVERY pump locked (no free starter), spawn seeded, fresh breaks', () => {
  const s = createInitialState();
  assert.equal(s.gasStation.pumps.length, settings.maxPumps);
  for (const pump of s.gasStation.pumps) {
    assert.equal(pump.roomUnlocked, false, 'the station does not exist until bought');
    assert.equal(pump.equipped, false);
    assert.equal(pump.car, null);
    assert.equal(pump.queue.length, 0);
    assert.equal(pump.pendingCash, 0);
    assert.equal(pump.hasAttendant, false);
    assert.equal(pump.break.onBreak, false);
    assert.equal(pump.break.jobCount, 0);
  }
  assert.equal(s.gasStation.spawnTimer, settings.gasStation.spawn.interval);
});

check('while fully locked, ticking the station never routes a car anywhere', () => {
  const s = createInitialState();
  for (let i = 0; i < 100; i++) tickGasStation(s, settings.gasStation.spawn.interval);
  for (const pump of s.gasStation.pumps) {
    assert.equal(pump.car, null);
    assert.equal(pump.queue.length, 0);
  }
});

check('spawnGasCar: tier formulas hold (fillTicks/payout scale with the rolled tier)', () => {
  const G = settings.gasStation.fill;
  const s = createInitialState();
  s.permanentReputation = 0; // every car is rusty
  const rusty = settings.carTiers[0];
  for (let i = 0; i < 200; i++) {
    const car = spawnGasCar(s);
    assert.equal(car.tier, 'rusty');
    assert.ok(Math.abs(car.fillTicks - G.baseTicks * rusty.ticksMult) < 1e-9);
    assert.ok(Math.abs(car.payout - G.basePayout * rusty.payoutMult) < 1e-9);
    assert.equal(car.ticksDone, 0);
    assert.equal(car.fixed, false);
    assert.deepEqual(car.damageParts, []);
  }
});

check('once bought, the first gas tick puts a car straight into pump 0', () => {
  const s = createInitialState();
  openGasPump(s);
  s.permanentReputation = 0; // rusty → pump 0
  tickGasStation(s, settings.gasStation.spawn.interval);
  assert.ok(s.gasStation.pumps[0].car);
  assert.equal(s.gasStation.pumps[0].queue.length, 0);
});

check("spawning fills pump 0 to maxQueuePerPump; locked pumps never get cars", () => {
  const s = createInitialState();
  openGasPump(s);
  s.permanentReputation = 0;
  for (let i = 0; i < 30; i++) tickGasStation(s, settings.gasStation.spawn.interval);
  assert.ok(s.gasStation.pumps[0].car);
  assert.equal(s.gasStation.pumps[0].queue.length, settings.gasStation.spawn.maxQueuePerPump);
  for (let i = 1; i < s.gasStation.pumps.length; i++) {
    assert.equal(s.gasStation.pumps[i].car, null);
    assert.equal(s.gasStation.pumps[i].queue.length, 0);
  }
});

check('NO tier routing: with only pump 0 open, every car tier lands there', () => {
  const s = createInitialState();
  openGasPump(s);
  s.permanentReputation = settings.reputation.repCap; // uniform roll across all five tiers
  s.gasStation.pumps[0].car = spawnGasCar(s); // occupy so the queue never drains
  for (let i = 0; i < 60; i++) tickGasStation(s, settings.gasStation.spawn.interval);
  const queue = s.gasStation.pumps[0].queue;
  assert.equal(queue.length, settings.gasStation.spawn.maxQueuePerPump, 'pump 0 takes every tier');
  const tiers = new Set(queue.map((c) => c.tier));
  assert.ok(tiers.size >= 2, `mixed tiers share one pump (saw ${[...tiers].join(', ')})`);
});

check('cars route to the shortest line across the open pumps', () => {
  const s = createInitialState();
  openGasPump(s, 0);
  openGasPump(s, 1);
  s.permanentReputation = settings.reputation.repCap; // any tier — routing must not care
  // Occupy both bays so routing only ever grows the queues.
  s.gasStation.pumps[0].car = spawnGasCar(s);
  s.gasStation.pumps[1].car = spawnGasCar(s);
  for (let i = 0; i < 12; i++) tickGasStation(s, settings.gasStation.spawn.interval);
  const q0 = s.gasStation.pumps[0].queue.length;
  const q1 = s.gasStation.pumps[1].queue.length;
  assert.ok(q0 > 0 && q1 > 0, 'both pumps take cars');
  assert.ok(Math.abs(q0 - q1) <= 1, `queues stay balanced (${q0} vs ${q1})`);
});

check('the FIRST buyGasExpand opens pump lot 0 (the whole station), not equipped yet', () => {
  const s = createInitialState();
  completeGasPrereqs(s); // isolate the cash gate from the endgame prereq gate
  s.cash = 0;
  assert.equal(buyGasExpand(s), false, 'gated on cash');
  assert.equal(s.gasStation.pumps[0].roomUnlocked, false);
  s.cash = 1e9;
  assert.equal(buyGasExpand(s), true);
  assert.equal(s.gasStation.pumps[0].roomUnlocked, true, 'first purchase opens lot 0');
  assert.equal(s.gasStation.pumps[0].equipped, false, 'still needs the pump installed');
  assert.equal(s.gasStation.pumps[1].roomUnlocked, false, 'later lots stay locked');
  // The next expand behaves like the garage's subsequent unlocks.
  assert.equal(buyGasExpand(s), true);
  assert.equal(s.gasStation.pumps[1].roomUnlocked, true);
  assert.equal(s.gasStation.pumps[1].equipped, false);
});

check('the first gas expand is locked until the garage AND market are fully built out', () => {
  const s = createInitialState();
  s.cash = 1e12; // cash is never the blocker in this test
  assert.equal(gasStationPrereqs(s).ready, false);
  assert.equal(buyGasExpand(s), false, 'fresh game: station locked despite ample cash');
  assert.equal(s.gasStation.pumps[0].roomUnlocked, false);
  assert.equal(s.cash, 1e12, 'nothing charged');

  // Garage fully built out but the market untouched: still locked.
  for (const pit of s.pits) {
    pit.roomUnlocked = true;
    pit.equipped = true;
    pit.hasMechanic = true;
    pit.workerSpeedLevel = settings.upgrades.workerSpeed.maxLevel;
    pit.fixingTimeLevel = settings.upgrades.fixingTime.maxLevel;
  }
  assert.equal(buyGasExpand(s), false, 'garage alone is not enough');
  assert.ok(gasStationPrereqs(s).missing.length > 0, 'market requirements still listed');

  // Market complete too: the station finally opens.
  s.supermarket.unlocked = true;
  s.supermarket.workerLevel = 2;
  s.supermarket.truckUpgradeLevel = settings.supermarket.truck.deliveryTimes.length - 1;
  assert.equal(gasStationPrereqs(s).ready, true);
  assert.deepEqual(gasStationPrereqs(s).missing, []);
  assert.equal(buyGasExpand(s), true, 'both complete → the station can be bought');
  assert.equal(s.gasStation.pumps[0].roomUnlocked, true);
});

check('every single unmet prereq keeps the station locked (mechanics, levels, market steps)', () => {
  const base = () => {
    const s = createInitialState();
    completeGasPrereqs(s);
    s.cash = 1e12;
    return s;
  };
  const blocked = (mutate) => {
    const s = base();
    mutate(s);
    assert.equal(gasStationPrereqs(s).ready, false);
    assert.equal(buyGasExpand(s), false);
  };
  blocked((s) => (s.pits[4].equipped = false));
  blocked((s) => (s.pits[2].hasMechanic = false));
  blocked((s) => (s.pits[0].workerSpeedLevel = settings.upgrades.workerSpeed.maxLevel - 1));
  blocked((s) => (s.pits[3].fixingTimeLevel = settings.upgrades.fixingTime.maxLevel - 1));
  blocked((s) => (s.supermarket.unlocked = false));
  blocked((s) => (s.supermarket.workerLevel = 1));
  blocked((s) => (s.supermarket.truckUpgradeLevel = 0));

  // The unmutated baseline does open.
  const s = base();
  assert.equal(buyGasExpand(s), true);
});

check('the prereq gate only guards the FIRST gas expand, not later lots', () => {
  const s = createInitialState();
  completeGasPrereqs(s);
  s.cash = 1e12;
  assert.equal(buyGasExpand(s), true); // lot 0: the gated station purchase
  // Un-max the garage again: later lots must still be purchasable (cash-only gate).
  s.pits[0].workerSpeedLevel = 0;
  assert.equal(buyGasExpand(s), true, 'lot 1 is cash-gated only');
  assert.equal(s.gasStation.pumps[1].roomUnlocked, true);
});

check('buyGasEquipment needs an opened lot, then equips it; freshly equipped pump takes cars', () => {
  const s = createInitialState();
  completeGasPrereqs(s);
  s.cash = 1e9;
  assert.equal(buyGasEquipment(s, 0), false); // station not bought yet
  buyGasExpand(s);
  assert.equal(buyGasEquipment(s, 0), true);
  assert.equal(s.gasStation.pumps[0].equipped, true);
  buyGasExpand(s);
  buyGasEquipment(s, 1);
  // Shortest-line routing spreads incoming cars over both open pumps.
  for (let i = 0; i < 50; i++) tickGasStation(s, settings.gasStation.spawn.interval);
  assert.ok(s.gasStation.pumps[0].car);
  assert.ok(s.gasStation.pumps[1].car);
});

check('gas expand cost grows geometrically; pump equipment cost scales with index', () => {
  const s = createInitialState();
  completeGasPrereqs(s);
  s.cash = 1e9;
  const c0 = gasExpandCost(s);
  buyGasExpand(s);
  const c1 = gasExpandCost(s);
  assert.ok(c1 > c0);
  assert.equal(c1, Math.round(c0 * settings.upgrades.gas.expand.costGrowth));
  assert.ok(gasEquipmentCost(s, 2) > gasEquipmentCost(s, 1));
});

check('tapFill needs a present player and a car at the pump', () => {
  const s = createInitialState();
  openGasPump(s);
  s.permanentReputation = 0;
  tickGasStation(s, settings.gasStation.spawn.interval); // car now at pump 0
  s.gasStation.pumps[0].playerPresent = false;
  tapFill(s, 0);
  assert.equal(s.gasStation.pumps[0].car.ticksDone, 0);
  s.gasStation.pumps[0].playerPresent = true;
  tapFill(s, 0);
  assert.equal(s.gasStation.pumps[0].car.ticksDone, settings.repair.tapTicks);
});

check('finishing a fill parks its payout at the pump, collected on the next tick', () => {
  const s = createInitialState();
  openGasPump(s);
  s.permanentReputation = 0;
  tickGasStation(s, settings.gasStation.spawn.interval);
  s.gasStation.pumps[0].playerPresent = true;
  const car = s.gasStation.pumps[0].car;
  const expectedTaps = Math.ceil(requiredFillTicks(car) / settings.repair.tapTicks);
  let taps = 0;
  while (s.gasStation.pumps[0].car === car && taps < 1000) {
    tapFill(s, 0);
    taps += 1;
  }
  assert.equal(taps, expectedTaps);
  assert.equal(s.gasStation.pumps[0].car, null);
  assert.equal(s.cash, 0); // no cashier: the pay waits at the pump
  assert.equal(s.gasStation.pumps[0].pendingCash, car.payout);
  tickGasStation(s, 0); // player is standing here → banked
  assert.equal(s.cash, car.payout);
  assert.equal(s.gasStation.pumps[0].pendingCash, 0);
});

check('hireAttendant requires an equipped pump and is one-time', () => {
  const s = createInitialState();
  completeGasPrereqs(s);
  s.cash = 1e9;
  assert.equal(hireAttendant(s, 0), false, 'station not bought yet');
  buyGasExpand(s); // pump lot 0 opened but not equipped
  assert.equal(hireAttendant(s, 0), false);
  buyGasEquipment(s, 0);
  assert.equal(hireAttendant(s, 0), true);
  assert.equal(s.gasStation.pumps[0].hasAttendant, true);
  assert.equal(hireAttendant(s, 0), false, 'one-time hire');
});

check('a hired attendant auto-fills; with no cashier the pay waits at the pump', () => {
  const s = createInitialState();
  openGasPump(s);
  s.cash = 1e9;
  hireAttendant(s, 0);
  s.cash = 0; // isolate earnings; the player is never near the pump
  for (let i = 0; i < 1500; i++) tickGasStation(s, 0.016); // ~24s hands-free
  assert.equal(s.cash, 0, 'nothing banked without a cashier or the player nearby');
  assert.ok(s.gasStation.pumps[0].pendingCash > 0, 'attendant pay piles up at the pump');
  const waiting = s.gasStation.pumps[0].pendingCash;
  s.gasStation.pumps[0].playerPresent = true;
  tickGasStation(s, 0.016);
  assert.ok(s.cash >= waiting, 'walking up collects the waiting pay');
  assert.equal(s.gasStation.pumps[0].pendingCash, 0);
});

check('pre-attendant, an unmanned pump does NOT fill on its own', () => {
  const s = createInitialState();
  openGasPump(s);
  s.permanentReputation = 0;
  tickGasStation(s, settings.gasStation.spawn.interval);
  const car = s.gasStation.pumps[0].car;
  const before = car.ticksDone;
  for (let i = 0; i < 600; i++) tickGasStation(s, 0.016);
  if (s.gasStation.pumps[0].car === car) assert.equal(s.gasStation.pumps[0].car.ticksDone, before);
});

check('with a cashier, pump payouts bank straight to cash, nothing waits', () => {
  const s = createInitialState();
  openGasPump(s);
  s.cash = 1e9;
  buyCashier(s);
  hireAttendant(s, 0);
  const before = s.cash;
  for (let i = 0; i < 2000; i++) tickGasStation(s, 0.016); // player never near the pump
  assert.ok(s.cash > before, 'cashier banks pump payouts hands-free');
  for (const pump of s.gasStation.pumps) assert.equal(pump.pendingCash, 0);
});

check('hiring the cashier sweeps waiting pump pay too', () => {
  const s = createInitialState();
  const cost = cashierCost(s);
  s.cash = 100 + cost;
  s.gasStation.pumps[0].pendingCash = 40;
  assert.equal(buyCashier(s), true);
  assert.equal(s.cash, 100 + 40, 'cost paid, waiting pump pay swept in');
  assert.equal(s.gasStation.pumps[0].pendingCash, 0);
});

check('hurryPump only works on a manned pump and multiplies the fill rate', () => {
  const s0 = createInitialState();
  hurryPump(s0, 0);
  assert.equal(s0.gasStation.pumps[0].hurryTimer, 0);

  // controlled pump car big enough not to finish in one step
  const make = () => {
    const s = createInitialState();
    openGasPump(s);
    s.cash = 1e9;
    hireAttendant(s, 0);
    s.gasStation.pumps[0].car = { id: 999, tier: 'rusty', fillTicks: 1e6, ticksDone: 0, damageParts: [], payout: 5, fixed: false, settleRemaining: 0 };
    return s;
  };
  const base = make();
  tickGasStation(base, 0.1);
  const baseWork = base.gasStation.pumps[0].car.ticksDone;

  const fast = make();
  hurryPump(fast, 0);
  assert.ok(fast.gasStation.pumps[0].hurryTimer > 0);
  tickGasStation(fast, 0.1);
  const fastWork = fast.gasStation.pumps[0].car.ticksDone;

  assert.ok(fastWork > baseWork);
  assert.ok(Math.abs(fastWork / baseWork - settings.hurry.multiplier) < 0.05);
});

check('attendant speed raises only its own pump rate, capped at maxLevel', () => {
  const s = createInitialState();
  openGasPump(s, 0);
  openGasPump(s, 1);
  s.cash = 1e9;
  const r0 = attendantSpeed(s.gasStation.pumps[0]);
  assert.equal(buyAttendantSpeed(s, 0), false, 'gated until the attendant is hired');
  hireAttendant(s, 0);
  assert.equal(buyAttendantSpeed(s, 0), true);
  assert.ok(attendantSpeed(s.gasStation.pumps[0]) > r0);
  assert.equal(attendantSpeed(s.gasStation.pumps[1]), r0); // untouched
  for (let i = 0; i < 50; i++) buyAttendantSpeed(s, 0); // hit max
  assert.equal(s.gasStation.pumps[0].workerSpeedLevel, settings.upgrades.gas.workerSpeed.maxLevel);
  assert.equal(buyAttendantSpeed(s, 0), false, 'capped');
});

check('the gas economy is independent: fills never touch pit tires or pit cash', () => {
  const s = createInitialState();
  openGasPump(s);
  s.cash = 1e9;
  hireAttendant(s, 0);
  const tiresBefore = s.pits[0].tiresRemaining;
  for (let i = 0; i < 1000; i++) tickGasStation(s, 0.016);
  assert.equal(s.pits[0].tiresRemaining, tiresBefore, 'pit tires untouched by pump fills');
  for (const pit of s.pits) assert.equal(pit.pendingCash, 0, 'no pit ever holds pump pay');
});

check('the gas gate only exists once the station is bought; then the player can walk out', () => {
  // Before the first purchase the left wall is solid EVEN at the gate's z.
  const locked = createInitialState();
  locked.player.position = { x: -40, z: settings.gasStation.gateZ };
  locked.input.x = -1;
  for (let i = 0; i < 200; i++) tick(locked, 0.1);
  assert.ok(
    locked.player.position.x >= -settings.world.halfX + settings.player.radius - 1e-6,
    'left wall solid while the station does not exist'
  );

  // After buying the first lot: pushing left at the gate's z crosses the wall.
  const s = createInitialState();
  completeGasPrereqs(s);
  s.cash = 1e9;
  buyGasExpand(s); // opens pump lot 0 — the station (and its gate) now exists
  s.player.position = { x: -40, z: settings.gasStation.gateZ };
  s.input.x = -1;
  for (let i = 0; i < 200; i++) tick(s, 0.1);
  assert.ok(s.player.position.x < -settings.world.halfX, 'walked out through the gas gate');

  // Away from the gate's z: the left wall stays solid even with the station open.
  const s2 = createInitialState();
  completeGasPrereqs(s2);
  s2.cash = 1e9;
  buyGasExpand(s2);
  s2.player.position = { x: -40, z: -8 };
  s2.input.x = -1;
  for (let i = 0; i < 200; i++) tick(s2, 0.1);
  assert.ok(
    s2.player.position.x >= -settings.world.halfX + settings.player.radius - 1e-6,
    'left wall solid away from the gate'
  );
});

check('out at the gas station, the far edge is an invisible wall — the player cannot leave the game area', () => {
  const s = createInitialState();
  completeGasPrereqs(s);
  s.cash = 1e9;
  buyGasExpand(s);
  s.player.position = { x: -40, z: settings.gasStation.gateZ };
  s.input.x = -1;
  for (let i = 0; i < 500; i++) tick(s, 0.1); // far more than enough to cross the whole station
  assert.ok(s.player.position.x < -settings.world.halfX, 'walked out through the gas gate');
  assert.ok(
    s.player.position.x >= settings.gasStation.leftLimitX + settings.player.radius - 1e-6,
    'held at the station\'s far edge (gasStation.leftLimitX), never off the world'
  );
});

check('an attendant goes on break after breakThreshold fills, rests at its pump-side break spot, then resumes', () => {
  const s = createInitialState();
  openGasPump(s);
  s.permanentReputation = 0; // rusty cars → pump 0
  s.cash = 1e9;
  hireAttendant(s, 0);

  let guard = 0;
  while (!s.gasStation.pumps[0].break.onBreak && guard < 200000) {
    tickGasStation(s, 0.05);
    guard += 1;
  }
  const pump = s.gasStation.pumps[0];
  assert.equal(pump.break.onBreak, true, 'attendant eventually takes a break');
  assert.equal(pump.break.jobCount, 0);

  // The attendant walks to (and holds) ITS OWN break spot beside the pump.
  const spot = settings.breaks.pumpBreakSpots[0];
  for (let i = 0; i < 200; i++) tickGasStation(s, 0.05); // plenty to finish the walk
  assert.ok(
    Math.hypot(pump.attendant.position.x - spot.x, pump.attendant.position.z - spot.z) < 0.1,
    'attendant rests at its pump-side break spot'
  );
  assert.equal(pump.attendant.state, 'onBreak');

  // While seated, the car at the pump makes no fill progress.
  const car = pump.car;
  if (car) {
    const before = car.ticksDone;
    for (let i = 0; i < 50; i++) tickGasStation(s, 0.05); // 2.5s, well under the break duration
    if (pump.car === car) assert.equal(pump.car.ticksDone, before, 'no auto-fill while on break');
  }

  // Ending the break (ad reward) lets it work again: pay accrues at the pump.
  endBreak(pump.break);
  pump.playerPresent = false;
  pump.pendingCash = 0;
  for (let i = 0; i < 4000; i++) tickGasStation(s, 0.05);
  assert.ok(pump.pendingCash > 0, 'work resumes (and pay accrues) after the break ends');
});

check('a manual tap-fill with no attendant never accrues a break', () => {
  const s = createInitialState();
  openGasPump(s);
  s.permanentReputation = 0;
  tickGasStation(s, settings.gasStation.spawn.interval);
  s.gasStation.pumps[0].playerPresent = true;
  const car = s.gasStation.pumps[0].car;
  while (s.gasStation.pumps[0].car === car) tapFill(s, 0);
  assert.equal(s.gasStation.pumps[0].break.jobCount, 0, 'no attendant → no break counter movement');
  assert.equal(s.gasStation.pumps[0].break.onBreak, false);
});

// --- physical unlock markers ------------------------------------------------
console.log('\ncore physical unlock markers');

const markersByKind = (s) => {
  const map = new Map();
  for (const m of getUnlockMarkers(s)) map.set(m.index === undefined ? m.kind : `${m.kind}:${m.index}`, m);
  return map;
};

check('fresh game: expand (rep-locked), pit-0 hire, market, cashier and gas markers — nothing else', () => {
  const s = createInitialState();
  const m = markersByKind(s);
  assert.equal(m.size, 5);

  const expand = m.get('expandRoom:1');
  assert.ok(expand, 'next locked lot (B) carries the expand marker');
  assert.equal(expand.cost, expandRoomCost(s));
  assert.equal(expand.locked, true, 'rep 5% < lot B\'s 10% gate');
  assert.deepEqual({ x: expand.x, z: expand.z }, settings.pit.positions[1]);

  const hire = m.get('hireMechanic:0');
  assert.ok(hire, 'pit 0 is equipped but unmanned → hire marker');
  assert.equal(hire.cost, hireCost(s, 0));
  assert.equal(hire.x, settings.pit.positions[0].x + settings.unlockMarkers.hireOffset.x);
  assert.equal(hire.z, settings.pit.positions[0].z + settings.unlockMarkers.hireOffset.z);

  const gas = m.get('gasExpand:0');
  assert.ok(gas, 'the station purchase has a marker from the start');
  assert.equal(gas.locked, true, 'locked behind the garage+market prereqs');
  assert.equal(gas.x, -settings.world.halfX + settings.unlockMarkers.gasEntryInset, 'inside the left wall — the pump row is unreachable');
  assert.equal(gas.z, settings.gasStation.gateZ);

  assert.equal(m.get('openMarket').cost, supermarketCost(s));
  assert.equal(m.get('hireCashier').cost, cashierCost(s));
  assert.ok(!m.has('pitEquipment:1'), 'no equipment marker before the land is bought');
  assert.ok(!m.has('hireMarketWorker'), 'no worker hire before the market opens');
});

check('markers advance with progression: expand → equipment → hire, unlock → worker hire', () => {
  const s = createInitialState();
  s.cash = 1e9;
  s.permanentReputation = settings.reputation.repCap;

  let m = markersByKind(s);
  assert.equal(m.get('expandRoom:1').locked, false, 'rep met → unlocked marker');

  buyExpandRoom(s);
  m = markersByKind(s);
  assert.ok(m.has('pitEquipment:1'), 'equipment marker appears on the bought lot');
  assert.ok(m.has('expandRoom:2'), 'the expand marker moved to the next lot');

  buyPitEquipment(s, 1);
  m = markersByKind(s);
  assert.ok(!m.has('pitEquipment:1'));
  assert.ok(m.has('hireMechanic:1'), 'hire marker appears once equipped');

  hireMechanic(s, 1);
  assert.ok(!markersByKind(s).has('hireMechanic:1'), 'hire marker gone once manned');

  buySupermarket(s);
  m = markersByKind(s);
  assert.ok(!m.has('openMarket'));
  assert.ok(m.has('hireMarketWorker'), 'worker hire marker appears once the market opens');
  assert.equal(m.get('hireMarketWorker').locked, true, 'but locked until the cashier is hired');
  assert.equal(hireMarketWorker(s), false, 'the gate holds behind the locked marker');

  buyCashier(s);
  m = markersByKind(s);
  assert.ok(!m.has('hireCashier'));
  assert.equal(m.get('hireMarketWorker').locked, false, 'cashier hired → worker hire unlocks');
  hireMarketWorker(s);
  assert.ok(!markersByKind(s).has('hireMarketWorker'));
});

check('gas markers: station first (at the gate), then per-lot expand/equip/hire on the pumps', () => {
  const s = createInitialState();
  completeGasPrereqs(s);
  s.cash = 1e12;

  let m = markersByKind(s);
  assert.equal(m.get('gasExpand:0').locked, false, 'prereqs met → station marker unlocked');

  buyGasExpand(s); // the station now exists
  m = markersByKind(s);
  const expand1 = m.get('gasExpand:1');
  assert.ok(expand1, 'next lot\'s expand marker sits on the pump row');
  assert.deepEqual({ x: expand1.x, z: expand1.z }, settings.gasStation.positions[1]);
  assert.ok(m.has('gasEquipment:0'), 'lot 0 wants its pump installed');

  buyGasEquipment(s, 0);
  m = markersByKind(s);
  assert.ok(!m.has('gasEquipment:0'));
  assert.ok(m.has('hireAttendant:0'), 'attendant hire marker appears once the pump is in');
  hireAttendant(s, 0);
  assert.ok(!markersByKind(s).has('hireAttendant:0'));
});

check('buyUnlockMarker routes to the same gated purchases (rep + prereq + cash gates intact)', () => {
  const s = createInitialState();
  assert.equal(buyUnlockMarker(s, 'hireMechanic', 0), false, 'cash gate holds at the marker');
  s.cash = 1e9;
  assert.equal(buyUnlockMarker(s, 'expandRoom', 1), false, 'rep gate holds at the marker');
  assert.equal(buyUnlockMarker(s, 'gasExpand', 0), false, 'gas prereq gate holds at the marker');

  s.permanentReputation = settings.pit.unlockReputation[1];
  assert.equal(buyUnlockMarker(s, 'expandRoom', 1), true);
  assert.equal(buyUnlockMarker(s, 'pitEquipment', 1), true);
  assert.equal(buyUnlockMarker(s, 'hireMechanic', 1), true);
  assert.equal(buyUnlockMarker(s, 'openMarket'), true);
  assert.equal(buyUnlockMarker(s, 'hireMarketWorker'), false, 'cashier gate holds at the marker');
  assert.equal(buyUnlockMarker(s, 'hireCashier'), true);
  assert.equal(buyUnlockMarker(s, 'hireMarketWorker'), true);
  assert.equal(s.pits[1].equipped && s.pits[1].hasMechanic, true);
  assert.equal(s.supermarket.workerLevel, 1);
  assert.equal(s.hasCashier, true);
  assert.equal(buyUnlockMarker(s, 'bogusKind'), false, 'unknown kinds are a safe no-op');
});

// --- "Shorter Breaks" upgrade -------------------------------------------------
console.log('\ncore shorter-breaks upgrade');

check('initial state: every worker type at break level 0, base duration applies', () => {
  const s = createInitialState();
  assert.deepEqual(s.breakLevels, { carMechanic: 0, marketWorker: 0, gasAttendant: 0 });
  const b = createBreakState('carMechanic');
  assert.equal(breakDuration(b, s), settings.breakDurations.base);
  assert.equal(breakDuration(b), settings.breakDurations.base, 'stateless call falls back to base');
});

check('each level halves the duration (300 → 150 → 75)', () => {
  const base = settings.breakDurations.base;
  assert.equal(breakDurationAtLevel(0), base);
  assert.equal(breakDurationAtLevel(1), base / 2);
  assert.equal(breakDurationAtLevel(2), base / 4);
});

check('buyBreakDuration: per-type level, geometric cost, capped at maxLevel', () => {
  const s = createInitialState();
  const cfg = settings.upgrades.breakDuration;
  assert.equal(buyBreakDuration(s, 'carMechanic'), false, 'no cash');

  s.cash = 1e9;
  const c0 = breakDurationCost(s, 'carMechanic');
  assert.equal(c0, cfg.carMechanic.baseCost);
  assert.equal(buyBreakDuration(s, 'carMechanic'), true);
  assert.equal(s.breakLevels.carMechanic, 1);
  assert.equal(s.breakLevels.marketWorker, 0, 'other types untouched');
  const c1 = breakDurationCost(s, 'carMechanic');
  assert.equal(c1, Math.round(c0 * cfg.carMechanic.costGrowth));

  assert.equal(buyBreakDuration(s, 'carMechanic'), true);
  assert.equal(buyBreakDuration(s, 'carMechanic'), false, 'capped at maxLevel');
  assert.equal(s.breakLevels.carMechanic, cfg.maxLevel);
  assert.equal(buyBreakDuration(s, 'bogusKind'), false, 'unknown kinds are a safe no-op');
});

check('an upgraded type\'s break actually ends at the halved duration', () => {
  const s = createInitialState();
  s.cash = 1e9;
  buyBreakDuration(s, 'gasAttendant'); // level 1: 150s
  const b = s.gasStation.pumps[0].break;
  b.onBreak = true;
  const half = settings.breakDurations.base / 2;
  tickBreak(b, half - 0.01, s);
  assert.equal(b.onBreak, true);
  assert.ok(Math.abs(breakRemaining(b, s) - 0.01) < 1e-9);
  tickBreak(b, 0.02, s); // crosses the halved duration
  assert.equal(b.onBreak, false);
});

// --- player speed upgrade -------------------------------------------------
console.log('\ncore player speed upgrade');

check('buyPlayerSpeed: one-time flat purchase, gated on cash', () => {
  const s = createInitialState();
  assert.equal(s.playerSpeedBought, false);
  assert.equal(playerSpeedMultiplier(s), 1);
  assert.equal(buyPlayerSpeed(s), false, 'no cash yet');

  s.cash = playerSpeedCost(s);
  assert.equal(buyPlayerSpeed(s), true);
  assert.equal(s.cash, 0);
  assert.equal(s.playerSpeedBought, true);
  assert.equal(playerSpeedMultiplier(s), settings.upgrades.playerSpeed.multiplier);
  assert.equal(buyPlayerSpeed(s), false, 'one-time purchase');
});

check('with Player Speed owned, movement covers speed × multiplier per second', () => {
  const s = createInitialState();
  s.cash = playerSpeedCost(s);
  buyPlayerSpeed(s);
  const z0 = s.player.position.z;
  s.input.z = 1;
  const dt = 0.05; // small step so the move never reaches a wall or prop (like the diagonal test)
  tick(s, dt);
  const expected = settings.player.speed * settings.upgrades.playerSpeed.multiplier * dt;
  assert.ok(Math.abs(s.player.position.z - z0 - expected) < 1e-6);
});

console.log(`\n${passed} passed`);
