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
 * Reputation-weighted tier weights, always summing to 1. Reputation linearly
 * unlocks tiers: rep 0 activates only tier 0, and each 1/(N-1) of reputation
 * unlocks one more tier. Between two thresholds the newly unlocking tier's weight
 * ramps from 0 up to an equal share while the already-active tiers shed weight in
 * proportion, so at every threshold all active tiers are equally likely:
 *
 *   rep 0.000 → [1]
 *   rep 0.125 → [.75, .25]
 *   rep 0.250 → [.5, .5]
 *   rep 0.500 → [⅓, ⅓, ⅓]
 *   rep 0.750 → [.25, .25, .25, .25]
 *   rep 1.000 → [.2, .2, .2, .2, .2]
 */
export function tierWeights(rep) {
  const tiers = settings.carTiers;
  const scaled = rep * (tiers.length - 1);
  const k = Math.min(Math.floor(scaled), tiers.length - 1); // highest fully-active tier
  const f = scaled - k; // progress toward unlocking tier k+1

  const weights = new Array(tiers.length).fill(0);
  const wNew = f / (k + 2); // newly unlocking tier's share (0 at a threshold)
  const prevShare = (1 - wNew) / (k + 1); // each already-active tier's share
  for (let i = 0; i <= k; i++) weights[i] = prevShare;
  if (k + 1 < tiers.length) weights[k + 1] = wNew;
  return weights;
}

/** Pick a tier index 0..N-1 from the reputation-weighted distribution. */
function rollTierIndex(state) {
  const weights = tierWeights(getEffectiveReputation(state));
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
