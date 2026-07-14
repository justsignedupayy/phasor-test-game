import settings from '../config/settings.js';
import { workerSpeed, requiredTicks, attendantSpeed, REF_BASE_TICKS } from './upgrades.js';
import { requiredFillTicks } from './gasStation.js';
import { tierWeights } from './Car.js';
import { getEffectiveReputation } from './reputation.js';
import { computeTotal } from './supermarket.js';

function pitDollarsPerSec(pit) {
  if (!pit.hasMechanic) return 0;
  const tier = settings.carTiers[pit.index];
  const refCar = {
    baseTicks: REF_BASE_TICKS * tier.ticksMult,
    payout: settings.spawn.basePayoutPerPart * 3 * tier.payoutMult, // 3 parts, mirrors REF_BASE_TICKS
  };
  const ticksNeeded = requiredTicks(refCar, pit);
  if (ticksNeeded <= 0) return 0;
  return (workerSpeed(pit) / ticksNeeded) * refCar.payout;
}

function averageTierMults(state) {
  const weights = tierWeights(getEffectiveReputation(state));
  const total = weights.reduce((a, w) => a + w, 0) || 1;
  let ticksMult = 0;
  let payoutMult = 0;
  settings.carTiers.forEach((tier, i) => {
    const w = weights[i] / total;
    ticksMult += w * tier.ticksMult;
    payoutMult += w * tier.payoutMult;
  });
  return { ticksMult, payoutMult };
}

function pumpDollarsPerSec(pump, avgMults) {
  if (!pump.hasAttendant) return 0;
  const G = settings.gasStation.fill;
  const refCar = { fillTicks: G.baseTicks * avgMults.ticksMult, payout: G.basePayout * avgMults.payoutMult };
  const ticksNeeded = requiredFillTicks(refCar);
  if (ticksNeeded <= 0) return 0;
  return (attendantSpeed(pump) / ticksNeeded) * refCar.payout;
}

function marketDollarsPerSec(state) {
  const S = state.supermarket;
  if (!S.unlocked || S.workerLevel < 2) return 0;
  const M = settings.supermarket;
  const types = Object.keys(M.products);
  const avgItems = (M.customerMinItems + M.customerMaxItems) / 2;
  const perType = avgItems / types.length;
  const request = {};
  for (const type of types) request[type] = perType;
  return computeTotal(request) / M.customerSpawnInterval;
}

export function estimateOfflineEarnings(state, elapsedMs) {
  const O = settings.offline;
  if (elapsedMs < O.minSeconds * 1000) return 0;
  const clampedSeconds = Math.min(elapsedMs, O.maxHours * 3600 * 1000) / 1000;

  let dollarsPerSec = 0;
  for (const pit of state.pits) dollarsPerSec += pitDollarsPerSec(pit);

  const avgMults = averageTierMults(state);
  for (const pump of state.gasStation.pumps) dollarsPerSec += pumpDollarsPerSec(pump, avgMults);

  dollarsPerSec += marketDollarsPerSec(state);

  return dollarsPerSec * O.efficiency * clampedSeconds;
}
