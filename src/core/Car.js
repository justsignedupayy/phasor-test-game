import settings from '../config/settings.js';
import { getEffectiveReputation } from './reputation.js';

const ALL_PARTS = ['tire', 'smoke', 'dent'];
let nextId = 1;

export function seedIdCounter(state) {
  let max = 0;
  const slots = [...state.pits, ...state.gasStation.pumps]; // pumps share the id space
  for (const pit of slots) {
    if (pit.car) max = Math.max(max, pit.car.id);
    for (const car of pit.queue) max = Math.max(max, car.id);
  }
  if (max + 1 > nextId) nextId = max + 1;
}

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
    settleRemaining: 0,
  };
}

export function spawnGasCar(state) {
  const tier = settings.carTiers[rollTierIndex(state)];
  const G = settings.gasStation.fill;

  return {
    id: nextId++,
    tier: tier.name,
    fillTicks: G.baseTicks * tier.ticksMult,
    ticksDone: 0,
    damageParts: [], // nothing to repair — kept so CarView's progress plumbing stays valid
    payout: G.basePayout * tier.payoutMult,
    fixed: false,
    settleRemaining: 0, // same drive-in settle timer as a pit car (see core/gasStation.js)
  };
}
