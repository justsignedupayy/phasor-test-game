/**
 * Zero-dependency core tests. Proves movement + spawning + the multi-pit tick
 * repair/queue logic run and are correct entirely without Three.js.
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { createInitialState } from '../src/core/GameState.js';
import { tick, tapRepair, hurry } from '../src/core/simulation.js';
import { spawnCar, tierWeights } from '../src/core/Car.js';
import {
  buyExpandRoom,
  buyPitEquipment,
  hireMechanic,
  buyWorkerSpeed,
  buyFixingTime,
  buyCashier,
  buyConveyor,
  conveyorCost,
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
  buyBreakRoom,
  buyMarketBreakRoom,
  buyTruckFrequency,
  truckFrequencyCost,
} from '../src/core/upgrades.js';
import {
  createBreakState,
  incrementJobCount,
  tickBreak,
  endBreak,
  breakDuration,
  breakRemaining,
} from '../src/core/breaks.js';
import {
  getEffectiveReputation,
  buyAdvertising,
  activateRepBoost,
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
  truckDeliveryInterval,
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
  assert.deepEqual(s.player.position, { x: -27, z: 0 });
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

check('in the open (front) zone, position clamps to the full garage bounds', () => {
  const s = createInitialState();
  s.player.position.z = -5; // z <= BAY_ZONE_Z: open floor, never fenced by land ownership
  s.input.x = 1;
  for (let i = 0; i < 200; i++) tick(s, 0.1);
  const limX = settings.world.halfX - settings.player.radius;
  assert.ok(s.player.position.x <= limX + 1e-9 && s.player.position.x >= limX - 1e-6);
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
  buyExpandRoom(s);
  const after = ownedRightX(s);
  assert.ok(after > before);
});

check('once every pit is owned, the fence settles at the last lot, short of the far wall', () => {
  const s = createInitialState();
  s.cash = 1e9;
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
  assert.equal(buyExpandRoom(s), true);
  assert.equal(s.pits[1].roomUnlocked, true);
  assert.equal(s.pits[1].equipped, false);
});

check('expand fails without cash and leaves lot locked', () => {
  const s = createInitialState();
  s.cash = 0;
  assert.equal(buyExpandRoom(s), false);
  assert.equal(s.pits[1].roomUnlocked, false);
});

check('buyPitEquipment needs a roomUnlocked lot, then equips it', () => {
  const s = createInitialState();
  s.cash = 1e9;
  assert.equal(buyPitEquipment(s, 1), false); // not roomUnlocked yet
  buyExpandRoom(s);
  assert.equal(buyPitEquipment(s, 1), true);
  assert.equal(s.pits[1].equipped, true);
});

check('a freshly equipped pit starts accepting cars', () => {
  const s = createInitialState();
  s.cash = 1e9;
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

// --- per-pit upgrades -----------------------------------------------------
console.log('\ncore per-pit upgrades');

check('hireMechanic requires an equipped pit', () => {
  const s = createInitialState();
  s.cash = 1e9;
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
  assert.equal(buyWorkerSpeed(s, 0), true);
  assert.ok(workerSpeed(s.pits[0]) > r0);
  assert.equal(workerSpeed(s.pits[1]), r0); // untouched
});

check('fixing time lowers required ticks for its own pit (with a floor)', () => {
  const s = createInitialState();
  s.cash = 1e9;
  const car = { baseTicks: settings.repair.ticksPerPart * 3 };
  const before = requiredTicks(car, s.pits[0]);
  buyFixingTime(s, 0);
  assert.ok(requiredTicks(car, s.pits[0]) < before);
  for (let i = 0; i < 50; i++) buyFixingTime(s, 0); // hit max
  assert.ok(fixTimeFactor(s.pits[0]) >= settings.upgrades.fixingTime.factorFloor - 1e-9);
});

check('upgrade cost grows with level', () => {
  const s = createInitialState();
  s.cash = 1e9;
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

// --- tire storage + conveyor ----------------------------------------------
console.log('\ncore tire storage + conveyor');

check('initial state: each pit starts with a full tire stack and a full shelf', () => {
  const s = createInitialState();
  for (const pit of s.pits) {
    assert.equal(pit.tiresRemaining, settings.storage.maxTiresPerPit);
    assert.equal(pit.shelfBoxes, settings.storage.shelfCapacity);
  }
  assert.equal(s.player.carryingBox, false);
  assert.equal(s.player.carryingBoxPitIndex, null);
  assert.equal(s.hasConveyor, false);
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

check('conveyor auto-transfers one box → a full tire stack each interval', () => {
  const s = createInitialState();
  assert.equal(buyConveyor(s), false); // can't afford yet
  s.cash = conveyorCost(s);
  assert.equal(buyConveyor(s), true);
  assert.equal(s.hasConveyor, true);
  assert.equal(buyConveyor(s), false, 'one-time purchase');

  const pit = s.pits[0];
  pit.tiresRemaining = 0;
  pit.shelfBoxes = 5;

  // Just shy of the interval: nothing moves yet.
  tick(s, settings.storage.conveyorInterval - 0.01);
  assert.equal(pit.tiresRemaining, 0);
  assert.equal(pit.shelfBoxes, 5);

  // Cross the interval: the stack is topped to full. Shelf stock is infinite +
  // decorative, so the box count is never consumed.
  tick(s, 0.02);
  assert.equal(pit.tiresRemaining, settings.storage.maxTiresPerPit);
  assert.equal(pit.shelfBoxes, 5);
});

check('conveyor does nothing for a pit whose shelf is empty', () => {
  const s = createInitialState();
  s.hasConveyor = true;
  const pit = s.pits[0];
  pit.tiresRemaining = 0;
  pit.shelfBoxes = 0;
  tick(s, settings.storage.conveyorInterval + 0.01);
  assert.equal(pit.tiresRemaining, 0, 'no boxes to transfer');
  assert.equal(pit.shelfBoxes, 0);
});

// --- reputation + advertising ----------------------------------------------
console.log('\ncore reputation + advertising');

check('initial state: reputation starts at baseReputation, no boost, no ad purchases', () => {
  const s = createInitialState();
  assert.equal(s.permanentReputation, settings.reputation.baseReputation);
  assert.equal(s.repBoostRemaining, 0);
  assert.equal(s.adLevel, 0);
});

check('getEffectiveReputation: no boost = permanent rate; boosted = doubled, clamped to repCap', () => {
  const s = createInitialState();
  assert.equal(getEffectiveReputation(s), settings.reputation.baseReputation);

  s.repBoostRemaining = settings.reputation.boostDurationSeconds;
  assert.ok(Math.abs(getEffectiveReputation(s) - settings.reputation.baseReputation * settings.reputation.boostMultiplier) < 1e-9);

  s.permanentReputation = 0.9; // ×2 would exceed repCap (1.0)
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

check('activateRepBoost arms the timer and refuses to stack while one is active', () => {
  const s = createInitialState();
  activateRepBoost(s);
  assert.equal(s.repBoostRemaining, settings.reputation.boostDurationSeconds);

  tick(s, 10);
  const remaining = s.repBoostRemaining;
  assert.ok(remaining < settings.reputation.boostDurationSeconds);

  activateRepBoost(s); // no-op: a boost is already running
  assert.equal(s.repBoostRemaining, remaining);
});

check('tick decrements repBoostRemaining toward 0 and never goes negative', () => {
  const s = createInitialState();
  activateRepBoost(s);
  const steps = Math.ceil(settings.reputation.boostDurationSeconds) + 5; // run past the full boost
  for (let i = 0; i < steps; i++) tick(s, 1);
  assert.equal(s.repBoostRemaining, 0);
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

check('hireMarketWorker requires the supermarket to be open first, then spawns a worker', () => {
  const s = createInitialState();
  s.cash = 1e9;
  assert.equal(hireMarketWorker(s), false, 'market not open yet');
  buySupermarket(s);
  assert.equal(hireMarketWorker(s), true);
  assert.equal(s.supermarket.workerLevel, 1);
  assert.ok(s.supermarket.worker);
  assert.equal(hireMarketWorker(s), false, 'one-time hire');
});

check('trainMarketWorker requires a level-1 worker first', () => {
  const s = createInitialState();
  s.cash = 1e9;
  assert.equal(trainMarketWorker(s), false, 'no worker yet');
  buySupermarket(s);
  hireMarketWorker(s);
  assert.equal(trainMarketWorker(s), true);
  assert.equal(s.supermarket.workerLevel, 2);
  assert.equal(trainMarketWorker(s), false, 'one-time train');
});

check("a level-1 worker auto-packages a waiting customer's order with no manual taps", () => {
  const s = createInitialState();
  s.cash = 1e9;
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

check('truckDeliveryInterval follows the upgrade level', () => {
  const s = createInitialState();
  const intervals = settings.supermarket.truck.intervals;
  assert.equal(truckDeliveryInterval(s), intervals[0]);
  s.supermarket.truckUpgradeLevel = 2;
  assert.equal(truckDeliveryInterval(s), intervals[2]);
});

check('tickTruck dispatches at the interval; deliverStock refills and clears the flag', () => {
  const s = createInitialState();
  s.supermarket.unlocked = true;
  s.supermarket.restockBox.units = 0;
  const interval = truckDeliveryInterval(s);

  tickTruck(s, interval - 0.01);
  assert.equal(s.supermarket.truckArriving, false, 'not due yet');
  tickTruck(s, 0.02); // crosses the interval
  assert.equal(s.supermarket.truckArriving, true, 'truck dispatched');
  assert.equal(s.supermarket.truckTimer, 0, 'timer reset on dispatch');
  assert.equal(s.supermarket.restockBox.units, 0, 'box not filled until the truck lands');

  deliverStock(s);
  assert.equal(s.supermarket.restockBox.units, s.supermarket.restockBox.maxUnits, 'topped up to max');
  assert.equal(s.supermarket.truckArriving, false, 'arrival cleared');
});

check('tickTruck holds the clock while a truck is already in flight', () => {
  const s = createInitialState();
  s.supermarket.unlocked = true;
  s.supermarket.truckArriving = true;
  s.supermarket.truckTimer = 0;
  tickTruck(s, 100);
  assert.equal(s.supermarket.truckTimer, 0, 'no accrual mid-delivery');
});

check('deliverStock never exceeds maxUnits', () => {
  const s = createInitialState();
  const max = settings.supermarket.restockBox.maxUnits;
  s.supermarket.restockBox.units = max - 1;
  deliverStock(s);
  assert.equal(s.supermarket.restockBox.units, max, 'tops up, never overfills');
});

check('callTruckEarly fast-forwards so the next tick dispatches a delivery', () => {
  const s = createInitialState();
  s.supermarket.unlocked = true;
  s.supermarket.truckTimer = 0;
  callTruckEarly(s);
  assert.equal(s.supermarket.truckArriving, false, 'not dispatched until the next tick');
  tickTruck(s, 0); // a zero-dt tick still sees timer >= interval
  assert.equal(s.supermarket.truckArriving, true, 'early call dispatched on the next tick');
});

check('callTruckEarly is a no-op while a truck is already in flight', () => {
  const s = createInitialState();
  s.supermarket.unlocked = true;
  s.supermarket.truckArriving = true;
  s.supermarket.truckTimer = 5;
  callTruckEarly(s);
  assert.equal(s.supermarket.truckTimer, 5, 'left alone mid-delivery');
});

check('buyTruckFrequency steps the level with geometric cost, gated and capped', () => {
  const s = createInitialState();
  assert.equal(buyTruckFrequency(s), false, 'market not open yet');
  s.supermarket.unlocked = true;

  const maxLevel = settings.supermarket.truck.intervals.length - 1;
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
  buySupermarket(s);
  hireMarketWorker(s);
  trainMarketWorker(s);
  s.supermarket.spawnTimer = -1e9; // isolate restocking from customers
  s.supermarket.shelves[2].stock = 0;
  s.supermarket.restockBox.units = 0;

  // A window well under the delivery interval, so no truck arrives to refill it.
  const window = truckDeliveryInterval(s) * 0.4;
  for (let t = 0; t < window; t += 0.1) tickSupermarket(s, 0.1);
  assert.equal(s.supermarket.shelves[2].stock, 0, 'no restock while the box is empty');
  assert.equal(s.supermarket.restockBox.units, 0, 'box still empty (no early truck)');

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
  assert.equal(b.breakDurationUpgraded, false);
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

check('breakDuration halves once the break room is upgraded', () => {
  const b = createBreakState('carMechanic');
  assert.equal(breakDuration(b), settings.breakDurations.base);
  b.breakDurationUpgraded = true;
  assert.equal(breakDuration(b), settings.breakDurations.upgraded);
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

check('the market worker accrues a break per checkout and eventually sits', () => {
  const s = createInitialState();
  s.cash = 1e9;
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

check('buyBreakRoom needs a hired mechanic and is one-time per worker', () => {
  const s = createInitialState();
  s.cash = 1e9;
  assert.equal(buyBreakRoom(s, 0), false, 'no mechanic yet');
  hireMechanic(s, 0);
  assert.equal(buyBreakRoom(s, 0), true);
  assert.equal(s.pits[0].break.breakDurationUpgraded, true);
  assert.equal(buyBreakRoom(s, 0), false, 'one-time');
});

check('buyMarketBreakRoom needs a hired market worker and is one-time', () => {
  const s = createInitialState();
  s.cash = 1e9;
  assert.equal(buyMarketBreakRoom(s), false, 'no worker yet');
  buySupermarket(s);
  hireMarketWorker(s);
  assert.equal(buyMarketBreakRoom(s), true);
  assert.equal(s.supermarket.worker.break.breakDurationUpgraded, true);
  assert.equal(buyMarketBreakRoom(s), false, 'one-time');
});

console.log(`\n${passed} passed`);
