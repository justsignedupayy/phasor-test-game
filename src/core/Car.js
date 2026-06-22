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
 * across the five ascending tiers in settings.carTiers: each tier scales
 * baseTicks and payout by its own ticksMult / payoutMult. Higher reputation
 * attracts higher-index (better-paying) cars.
 */
import settings from '../config/settings.js';
import { getEffectiveReputation } from './reputation.js';

const ALL_PARTS = ['tire', 'smoke', 'dent'];
let nextId = 1;

/** After loading a save, keep new ids past whatever the restored cars already used. */
export function seedIdCounter(state) {
  let max = 0;
  for (const pit of state.pits) {
    if (pit.car) max = Math.max(max, pit.car.id);
    for (const car of pit.queue) max = Math.max(max, car.id);
  }
  if (max + 1 > nextId) nextId = max + 1;
}

/**
 * Pick a tier index 0..N-1 from a reputation-weighted roll. The weight for tier
 * i is a triangular bump centred on rep×(N-1): weight = max(0, 1 - |i - peak|).
 * This generalizes the old two-endpoint interpolation — rep 0 puts all weight on
 * the lowest tier, rep 1 on the highest, mid reputations spread across neighbors.
 */
function rollTierIndex(state) {
  const tiers = settings.carTiers;
  const peak = getEffectiveReputation(state) * (tiers.length - 1);

  const weights = tiers.map((_, i) => Math.max(0, 1 - Math.abs(i - peak)));
  const total = weights.reduce((a, w) => a + w, 0);

  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1; // float-rounding fallback
}

export function spawnCar(state) {
  const parts = ALL_PARTS.filter(() => Math.random() < 0.5);
  if (parts.length === 0) {
    parts.push(ALL_PARTS[Math.floor(Math.random() * ALL_PARTS.length)]);
  }
  const n = parts.length;

  const tier = settings.carTiers[rollTierIndex(state)];

  return {
    id: nextId++,
    tier: tier.name,
    baseTicks: settings.repair.ticksPerPart * n * tier.ticksMult, // before the pit's fixTimeFactor
    ticksDone: 0,
    damageParts: parts, // subset of ALL_PARTS, canonical order
    payout: settings.spawn.basePayoutPerPart * n * tier.payoutMult,
    fixed: false,
  };
}
