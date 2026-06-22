/**
 * Zero-dependency core tests. Proves movement + spawning + the multi-pit tick
 * repair/queue logic run and are correct entirely without Three.js.
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { createInitialState } from '../src/core/GameState.js';
import { tick, tapRepair, hurry } from '../src/core/simulation.js';
import { spawnCar } from '../src/core/Car.js';
import {
  buyExpandRoom,
  buyPitEquipment,
  hireMechanic,
  buyWorkerSpeed,
  buyFixingTime,
  workerSpeed,
  fixTimeFactor,
  requiredTicks,
  expandRoomCost,
  pitEquipmentCost,
  ownedRightX,
  allLandOwned,
} from '../src/core/upgrades.js';
import {
  getEffectiveReputation,
  buyAdvertising,
  activateRepBoost,
  adCost,
} from '../src/core/reputation.js';
import { formatMoney } from '../src/core/format.js';
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
  assert.deepEqual(s.player.position, { x: -6, z: 0 });
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

check('once every pit is owned, the bay clamp matches the outer wall (no fence left)', () => {
  const s = createInitialState();
  s.cash = 1e9;
  while (!allLandOwned(s)) buyExpandRoom(s);
  assert.equal(ownedRightX(s), settings.world.halfX);
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
  tick(s, settings.spawn.interval);
  assert.ok(s.pits[0].car);
  assert.equal(s.pits[0].queue.length, 0); // routed straight in, nothing left waiting
});

check("spawning is automatic and stalls at maxQueuePerPit (pit's car + full queue)", () => {
  const s = createInitialState();
  for (let i = 0; i < 30; i++) tick(s, settings.spawn.interval); // nobody repairs
  assert.ok(s.pits[0].car); // pit 0 holds one
  assert.equal(s.pits[0].queue.length, settings.spawn.maxQueuePerPit); // its queue is full, spawning stalled
});

check('pit refills from the front of its own queue after a fix', () => {
  const s = createInitialState();
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

check('spawns distribute to the shortest pit queue (2 equipped pits, 4 cars → 2 each)', () => {
  const s = createInitialState();
  s.cash = 1e9;
  buyExpandRoom(s);
  buyPitEquipment(s, 1); // pits 0 and 1 now equipped
  // Occupy both pits so routing never drains their queues during this test.
  s.pits[0].car = spawnCar(s);
  s.pits[1].car = spawnCar(s);
  for (let i = 0; i < 4; i++) tick(s, settings.spawn.interval);
  assert.equal(s.pits[0].queue.length, 2);
  assert.equal(s.pits[1].queue.length, 2);
});

check('spawns distribute across all 5 equipped pits (10 cars → 2 each)', () => {
  const s = createInitialState();
  s.cash = 1e9;
  for (let i = 1; i < settings.maxPits; i++) {
    buyExpandRoom(s); // unlocks pits in order (1, 2, 3, 4)
    buyPitEquipment(s, i);
  }
  assert.equal(s.pits.length, 5);
  // Occupy every pit so routing never drains their queues during this test.
  for (const pit of s.pits) pit.car = spawnCar(s);
  for (let i = 0; i < 10; i++) tick(s, settings.spawn.interval);
  for (const pit of s.pits) assert.equal(pit.queue.length, 2);
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
  tick(s, settings.spawn.interval); // car now in pit 0
  s.pits[0].playerPresent = false;
  tapRepair(s, 0);
  assert.equal(s.pits[0].car.ticksDone, 0);
  s.pits[0].playerPresent = true;
  tapRepair(s, 0);
  assert.equal(s.pits[0].car.ticksDone, settings.repair.tapTicks);
});

check('finishing a car pays its own payout and empties the pit', () => {
  const s = createInitialState();
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
  assert.equal(s.cash, car.payout);
  assert.equal(s.pits[0].car, null);
});

check('full flow: fix several cars, cash accrues by each payout', () => {
  const s = createInitialState();
  s.pits[0].playerPresent = true;
  let expected = 0;
  for (let r = 0; r < 5; r++) {
    tick(s, settings.spawn.interval); // ensure a car is present
    const car = s.pits[0].car;
    if (!car) continue;
    expected += car.payout;
    while (s.pits[0].car === car) tapRepair(s, 0);
  }
  assert.equal(s.cash, expected);
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
  for (let i = 0; i < 10; i++) tick(s, settings.spawn.interval);
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

check('a hired worker earns money hands-free (no player)', () => {
  const s = createInitialState();
  s.cash = 1e9;
  hireMechanic(s, 0);
  const after = s.cash;
  for (let i = 0; i < 1500; i++) tick(s, 0.016); // ~24s, no input, no taps
  assert.ok(s.cash > after, 'worker should auto-repair and earn');
});

check('pre-worker, an unmanned pit does NOT repair on its own', () => {
  const s = createInitialState();
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

check('spawnCar: a maxed-out reputation always rolls the top tier, scaled by its ticksMult/payoutMult', () => {
  const luxury = settings.carTiers[settings.carTiers.length - 1];
  const s = createInitialState();
  s.permanentReputation = settings.reputation.repCap;
  for (let i = 0; i < 50; i++) {
    const car = spawnCar(s);
    const n = car.damageParts.length;
    assert.equal(car.tier, 'luxury');
    assert.ok(Math.abs(car.baseTicks - settings.repair.ticksPerPart * n * luxury.ticksMult) < 1e-9);
    assert.ok(Math.abs(car.payout - settings.spawn.basePayoutPerPart * n * luxury.payoutMult) < 1e-9);
  }
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
  for (let i = 0; i < 1000; i++) tick(s, 1); // far longer than boostDurationSeconds
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

console.log(`\n${passed} passed`);
