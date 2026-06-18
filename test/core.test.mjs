/**
 * Zero-dependency core tests. Proves movement + spawning + the repair/queue
 * logic run and are correct entirely without Three.js. Run with: npm test
 */
import assert from 'node:assert/strict';
import { createInitialState } from '../src/core/GameState.js';
import { tick, tapRepair, hurry } from '../src/core/simulation.js';
import { spawnCar } from '../src/core/Car.js';
import {
  buyUpgrade,
  upgradeAvailable,
  mechanicRate,
  fixingWorkMult,
} from '../src/core/upgrades.js';
import settings from '../src/config/settings.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓', name);
}

// --- movement -------------------------------------------------------------
console.log('core simulation (3D movement)');

check('initial state: $0, player at origin, not moving', () => {
  const s = createInitialState();
  assert.equal(s.cash, 0);
  assert.deepEqual(s.player.position, { x: 0, z: 0 });
  assert.equal(s.player.moving, false);
});

check('full input for 1s travels exactly `speed` units', () => {
  const s = createInitialState();
  s.input.z = 1;
  tick(s, 1);
  assert.ok(Math.abs(s.player.position.z - settings.player.speed) < 1e-6);
});

check('diagonal input is not faster than cardinal', () => {
  const s = createInitialState();
  s.input.x = 1;
  s.input.z = 1;
  tick(s, 1);
  const dist = Math.hypot(s.player.position.x, s.player.position.z);
  assert.ok(Math.abs(dist - settings.player.speed) < 1e-6);
});

check('player rotates to face movement (+x → PI/2)', () => {
  const s = createInitialState();
  s.input.x = 1;
  tick(s, 0.016);
  assert.ok(Math.abs(s.player.rotation - Math.PI / 2) < 1e-6);
});

check('position clamps to garage bounds', () => {
  const s = createInitialState();
  s.input.x = 1;
  for (let i = 0; i < 200; i++) tick(s, 0.1);
  const limX = settings.world.halfX - settings.player.radius;
  assert.ok(s.player.position.x <= limX + 1e-9 && s.player.position.x >= limX - 1e-6);
});

// --- spawning + queue -----------------------------------------------------
console.log('\ncore spawning + queue');

check('initial state: empty pit, empty queue, spawn seeded', () => {
  const s = createInitialState();
  assert.equal(s.pit.car, null);
  assert.equal(s.carQueue.length, 0);
  assert.equal(s.spawnTimer, settings.spawn.interval);
});

check('first tick puts a car straight into the pit', () => {
  const s = createInitialState();
  tick(s, settings.spawn.interval);
  assert.ok(s.pit.car);
  assert.equal(s.carQueue.length, 0);
});

check('spawning is automatic and stalls at maxQueue (pit + full lane)', () => {
  const s = createInitialState();
  for (let i = 0; i < 30; i++) tick(s, settings.spawn.interval); // nobody repairs
  assert.ok(s.pit.car); // pit holds one
  assert.equal(s.carQueue.length, settings.spawn.maxQueue); // lane full, spawning stalled
});

check('pit refills from the front of the queue after a fix', () => {
  const s = createInitialState();
  for (let i = 0; i < 30; i++) tick(s, settings.spawn.interval);
  const front = s.carQueue[0];
  s.pit.car = null; // simulate the pit car being finished
  tick(s, 0.001);
  assert.equal(s.pit.car.id, front.id);
  assert.equal(s.carQueue.length, settings.spawn.maxQueue - 1);
});

// --- randomized damage ----------------------------------------------------
console.log('\ncore randomized damage');

check('spawnCar: non-empty canonical subset; work + payout scale with parts', () => {
  const canon = ['tire', 'smoke', 'dent'];
  for (let i = 0; i < 300; i++) {
    const car = spawnCar();
    const n = car.damageParts.length;
    assert.ok(n >= 1 && n <= 3);
    assert.deepEqual(car.damageParts, canon.filter((p) => car.damageParts.includes(p)));
    assert.equal(car.totalWork, settings.spawn.baseWorkPerPart * n);
    assert.equal(car.payout, settings.spawn.basePayoutPerPart * n);
    assert.equal(car.repairWork, 0);
    assert.equal(car.fixed, false);
  }
});

check('spawnCar produces variety (1-, 2- and 3-damage cars appear)', () => {
  const counts = new Set();
  for (let i = 0; i < 400; i++) counts.add(spawnCar().damageParts.length);
  assert.ok(counts.has(1) && counts.has(2) && counts.has(3));
});

check('value density (payout / work) is constant across damage counts', () => {
  const r = [1, 2, 3].map(
    (n) => (settings.spawn.basePayoutPerPart * n) / (settings.spawn.baseWorkPerPart * n)
  );
  assert.ok(r.every((x) => Math.abs(x - r[0]) < 1e-9));
});

// --- repair loop ----------------------------------------------------------
console.log('\ncore repair loop');

check('tapRepair needs a present player and a car in the pit', () => {
  const s = createInitialState();
  tick(s, settings.spawn.interval); // car now in the pit
  s.pit.playerPresent = false;
  tapRepair(s);
  assert.equal(s.pit.car.repairWork, 0);
  s.pit.playerPresent = true;
  tapRepair(s);
  assert.equal(s.pit.car.repairWork, settings.tap.tapValue);
});

check('finishing a car pays its own payout and empties the pit', () => {
  const s = createInitialState();
  tick(s, settings.spawn.interval);
  s.pit.playerPresent = true;
  const car = s.pit.car;
  const expectedTaps = Math.ceil(car.totalWork / settings.tap.tapValue);
  let taps = 0;
  while (s.pit.car === car && taps < 100) {
    tapRepair(s);
    taps += 1;
  }
  assert.equal(taps, expectedTaps);
  assert.equal(s.cash, car.payout);
  assert.equal(s.pit.car, null);
});

check('full flow: fix several cars, cash accrues by each payout', () => {
  const s = createInitialState();
  s.pit.playerPresent = true;
  let expected = 0;
  for (let r = 0; r < 5; r++) {
    tick(s, settings.spawn.interval); // ensure a car is present
    const car = s.pit.car;
    if (!car) continue;
    expected += car.payout;
    while (s.pit.car === car) tapRepair(s);
  }
  assert.equal(s.cash, expected);
  assert.ok(expected > 0);
});

// --- upgrades -------------------------------------------------------------
console.log('\ncore upgrades');

check('buyUpgrade fails without cash; deducts and applies on success', () => {
  const s = createInitialState();
  s.cash = 10;
  assert.equal(buyUpgrade(s, 'mechanic'), false);
  assert.equal(s.cash, 10);
  s.cash = 100;
  assert.equal(buyUpgrade(s, 'mechanic'), true);
  assert.equal(s.cash, 100 - settings.upgrades.mechanic.cost);
  assert.equal(s.upgrades.hasMechanic, true);
});

check('worker speed is locked until a mechanic is hired', () => {
  const s = createInitialState();
  s.cash = 1000;
  assert.equal(upgradeAvailable(s, 'workerSpeed'), false);
  assert.equal(buyUpgrade(s, 'workerSpeed'), false);

  buyUpgrade(s, 'mechanic');
  assert.equal(upgradeAvailable(s, 'workerSpeed'), true);
  const r0 = mechanicRate(s);
  assert.equal(buyUpgrade(s, 'workerSpeed'), true);
  assert.ok(mechanicRate(s) > r0);
});

check('upgrade cost grows with level', () => {
  const s = createInitialState();
  s.cash = 1e9;
  const c0 = settings.upgrades.fixingTime.baseCost;
  buyUpgrade(s, 'fixingTime');
  const c1 = Math.round(c0 * settings.upgrades.fixingTime.costGrowth);
  // after one purchase, the next costs more
  const before = s.cash;
  buyUpgrade(s, 'fixingTime');
  assert.equal(before - s.cash, c1);
});

check('fixing time reduces the work on newly spawned cars', () => {
  const s = createInitialState();
  s.cash = 1e9;
  const basePerPart = (() => {
    const car = spawnCar(fixingWorkMult(s));
    return car.totalWork / car.damageParts.length;
  })();
  buyUpgrade(s, 'fixingTime');
  buyUpgrade(s, 'fixingTime');
  const upPerPart = (() => {
    const car = spawnCar(fixingWorkMult(s));
    return car.totalWork / car.damageParts.length;
  })();
  assert.ok(upPerPart < basePerPart);
});

// --- mechanic + hurry -----------------------------------------------------
console.log('\ncore mechanic + hurry');

check('a hired mechanic earns money hands-free (no player)', () => {
  const s = createInitialState();
  s.cash = 500;
  buyUpgrade(s, 'mechanic');
  const after = s.cash;
  for (let i = 0; i < 1500; i++) tick(s, 0.016); // ~24s, no input, no taps
  assert.ok(s.cash > after, 'mechanic should auto-repair and earn');
});

check('pre-mechanic, the pit does NOT repair on its own', () => {
  const s = createInitialState();
  tick(s, settings.spawn.interval); // car arrives in the pit
  const car = s.pit.car;
  const before = car.repairWork;
  for (let i = 0; i < 600; i++) tick(s, 0.016); // ~10s, still no mechanic, no taps
  // same car, unchanged work (it only advanced via spawning, not repair)
  if (s.pit.car === car) assert.equal(s.pit.car.repairWork, before);
});

check('hurry only works with a mechanic and multiplies the work rate', () => {
  // no mechanic -> no-op
  const s0 = createInitialState();
  hurry(s0);
  assert.equal(s0.hurryTimer, 0);

  // controlled pit car big enough not to finish in one step
  const make = () => {
    const s = createInitialState();
    s.cash = 1000;
    buyUpgrade(s, 'mechanic');
    s.pit.car = { id: 999, totalWork: 1e6, repairWork: 0, damageParts: ['tire'], payout: 5, fixed: false };
    return s;
  };
  const base = make();
  tick(base, 0.1);
  const baseWork = base.pit.car.repairWork;

  const fast = make();
  hurry(fast);
  assert.ok(fast.hurryTimer > 0);
  tick(fast, 0.1);
  const fastWork = fast.pit.car.repairWork;

  assert.ok(fastWork > baseWork);
  assert.ok(Math.abs(fastWork / baseWork - settings.hurry.multiplier) < 0.05);
});

console.log(`\n${passed} passed`);
