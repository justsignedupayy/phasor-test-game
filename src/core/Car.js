/**
 * Car.js — pure car model + factory. No Three.js.
 *
 * spawnCar(state) picks a random non-empty subset of the damage parts (kept in
 * canonical order so the render and the per-part thresholds line up). Repair is
 * counted in ticks: baseTicks = ticksPerPart × numParts. The pit's fixing-time
 * upgrade later scales how many of those ticks are actually required. Payout
 * scales with the number of parts so value-per-tick stays ~constant.
 *
 * Reputation (state.permanentReputation / repBoostRemaining) biases the roll
 * toward a higher-paying "better" tier: same damage-part logic, but baseTicks
 * and payout are scaled up by betterTicksMult / betterPayoutMult.
 */
import settings from '../config/settings.js';
import { getEffectiveReputation } from './reputation.js';

const ALL_PARTS = ['tire', 'smoke', 'dent'];
let nextId = 1;

/** After loading a save, keep new ids past whatever the restored cars already used. */
export function seedIdCounter(state) {
  let max = 0;
  for (const pit of state.pits) if (pit.car) max = Math.max(max, pit.car.id);
  for (const car of state.carQueue) max = Math.max(max, car.id);
  if (max + 1 > nextId) nextId = max + 1;
}

export function spawnCar(state) {
  const parts = ALL_PARTS.filter(() => Math.random() < 0.5);
  if (parts.length === 0) {
    parts.push(ALL_PARTS[Math.floor(Math.random() * ALL_PARTS.length)]);
  }
  const n = parts.length;

  const isBetter = Math.random() < getEffectiveReputation(state);
  const tier = isBetter ? 'better' : 'normal';
  const R = settings.reputation;
  const ticksMult = isBetter ? R.betterTicksMult : 1;
  const payoutMult = isBetter ? R.betterPayoutMult : 1;

  return {
    id: nextId++,
    tier,
    baseTicks: settings.repair.ticksPerPart * n * ticksMult, // before the pit's fixTimeFactor
    ticksDone: 0,
    damageParts: parts, // subset of ALL_PARTS, canonical order
    payout: settings.spawn.basePayoutPerPart * n * payoutMult,
    fixed: false,
  };
}
