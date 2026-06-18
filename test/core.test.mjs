/**
 * Zero-dependency core tests. Proves the game logic runs and is correct
 * entirely without Phaser. Run with: npm test
 */
import assert from 'node:assert/strict';
import { createInitialState } from '../src/core/GameState.js';
import { tick, tapBay } from '../src/core/simulation.js';
import balance from '../src/config/balance.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓', name);
}

console.log('core simulation');

check('initial state: $0, one bay, one fresh car', () => {
  const s = createInitialState();
  assert.equal(s.cash, 0);
  assert.equal(s.bays.length, 1);
  assert.ok(s.bays[0].car);
  assert.equal(s.bays[0].car.repairWork, 0);
  assert.equal(s.bays[0].car.totalWork, balance.car.totalWork);
});

check('a tap adds tapValue to repairWork', () => {
  const s = createInitialState();
  tapBay(s, 1);
  assert.equal(s.bays[0].car.repairWork, balance.tap.tapValue);
});

check('damage markers clear in threshold order as repair progresses', () => {
  const s = createInitialState();
  const car = s.bays[0].car;
  const cleared = [];
  let guard = 0;
  while (s.bays[0].car === car && guard++ < 1000) {
    for (const e of tapBay(s, 1)) {
      if (e.type === 'damageCleared') cleared.push(e.markerId);
    }
  }
  assert.deepEqual(cleared, ['tire', 'smoke', 'dent']);
});

check('fixing a car pays out, then spawns a new car at zero work', () => {
  const s = createInitialState();
  const firstId = s.bays[0].car.id;
  let fixed = null;
  let spawned = null;
  let guard = 0;
  while (!fixed && guard++ < 1000) {
    for (const e of tapBay(s, 1)) {
      if (e.type === 'carFixed') fixed = e;
      if (e.type === 'carSpawned') spawned = e;
    }
  }
  assert.ok(fixed, 'car should be fixed');
  assert.equal(fixed.payout, balance.car.payout);
  assert.equal(s.cash, balance.car.payout);
  assert.ok(spawned, 'a new car should spawn');
  assert.notEqual(s.bays[0].car.id, firstId);
  assert.equal(s.bays[0].car.repairWork, 0);
});

check('repairWork never exceeds totalWork', () => {
  const s = createInitialState();
  for (let i = 0; i < 5; i++) tapBay(s, 1, 1000);
  assert.ok(s.bays[0].car.repairWork <= s.bays[0].car.totalWork);
});

check('tick is a no-op while mechanic.rate is 0', () => {
  const s = createInitialState();
  const before = s.bays[0].car.repairWork;
  const events = tick(s, 5.0);
  assert.equal(s.bays[0].car.repairWork, before + balance.mechanic.rate * 5.0);
  assert.equal(events.length, 0);
});

console.log(`\n${passed} passed`);
