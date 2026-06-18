/**
 * simulation.js — all game-logic mutation lives here. No Phaser.
 *
 * Two entry points mutate the state and return a list of events describing what
 * changed, so the renderer can react to transitions (marker cleared, car fixed,
 * car spawned) without owning any logic itself:
 *
 *   tick(state, dt)         advance time (auto-repair from mechanics)
 *   tapBay(state, bayId)    apply a player tap to a bay's car
 */
import balance from '../config/balance.js';
import { createCar } from './Car.js';

export const EventType = Object.freeze({
  DamageCleared: 'damageCleared',
  CarFixed: 'carFixed',
  CarSpawned: 'carSpawned',
});

/**
 * Advance the simulation by dt seconds. Auto-repair is driven by mechanic.rate
 * (0 for this slice, so this is a no-op until upgrades exist) — wiring it now
 * means mechanics drop in without touching the render loop.
 * @returns {Array} events
 */
export function tick(state, dt) {
  const events = [];
  const auto = balance.mechanic.rate * dt;
  if (auto > 0) {
    for (const bay of state.bays) {
      applyWork(state, bay, auto, events);
    }
  }
  return events;
}

/**
 * Apply a single player tap to the given bay's car.
 * @returns {Array} events
 */
export function tapBay(state, bayId, amount = balance.tap.tapValue) {
  const events = [];
  const bay = state.bays.find((b) => b.id === bayId);
  applyWork(state, bay, amount, events);
  return events;
}

/** Shared work-application path for both taps and ticks. Mutates, pushes events. */
function applyWork(state, bay, amount, events) {
  if (!bay || !bay.car || bay.car.isFixed || amount <= 0) {
    return;
  }

  const car = bay.car;
  car.repairWork = Math.min(car.totalWork, car.repairWork + amount);

  // Clear any damage markers whose threshold has now been passed.
  for (const marker of car.damage) {
    if (!marker.cleared && car.progress >= marker.clearAt) {
      marker.cleared = true;
      events.push({
        type: EventType.DamageCleared,
        bayId: bay.id,
        markerId: marker.id,
        marker,
      });
    }
  }

  // Car finished: pay out and immediately put a fresh broken car in the bay.
  if (car.isFixed) {
    state.cash += car.payout;
    events.push({
      type: EventType.CarFixed,
      bayId: bay.id,
      car,
      payout: car.payout,
      cash: state.cash,
    });

    bay.car = createCar();
    events.push({ type: EventType.CarSpawned, bayId: bay.id, car: bay.car });
  }
}
