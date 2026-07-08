/**
 * offlineEarnings.js — one-shot $/sec estimate used to grant offline earnings
 * on load (see platform/storage.js getSavedAt + scene/Hud.js startOfflineDrain).
 * No Three.js.
 *
 * Every per-worker rate below calls the SAME derived-effect functions the
 * Upgrades menu already uses (workerSpeed/fixTimeFactor/requiredTicks,
 * attendantSpeed/requiredFillTicks, computeTotal) against a representative
 * "average" car/order, so this can't drift out of sync with what's actually
 * paid out live.
 */
import settings from '../config/settings.js';
import { workerSpeed, requiredTicks, attendantSpeed, REF_BASE_TICKS } from './upgrades.js';
import { requiredFillTicks } from './gasStation.js';
import { tierWeights } from './Car.js';
import { getEffectiveReputation } from './reputation.js';
import { computeTotal } from './supermarket.js';

/** This pit's hired mechanic's steady-state $/sec, against a reference car of
 * its own routed tier (settings.carTiers[pit.index] — pits only ever see cars
 * of their own tier, see simulation.spawnToMatchingPit). 0 if unmanned. */
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

/** Reputation-weighted average {ticksMult, payoutMult} across every car tier —
 * pumps have no tier routing (any tier fills at any pump), so a pump's expected
 * car is drawn from the same weighted distribution spawnCar rolls against. */
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

/** This pump's hired attendant's steady-state $/sec, against the reputation-
 * weighted average car. 0 if unmanned. */
function pumpDollarsPerSec(pump, avgMults) {
  if (!pump.hasAttendant) return 0;
  const G = settings.gasStation.fill;
  const refCar = { fillTicks: G.baseTicks * avgMults.ticksMult, payout: G.basePayout * avgMults.payoutMult };
  const ticksNeeded = requiredFillTicks(refCar);
  if (ticksNeeded <= 0) return 0;
  return (attendantSpeed(pump) / ticksNeeded) * refCar.payout;
}

/** The market's steady-state $/sec: only counted once the worker is fully
 * trained (workerLevel 2) — hands-free packaging AND restocking, since nobody
 * is around to do either by hand while offline. Uses computeTotal (the same
 * checkout pricing function checkoutCustomer pays out) against an average
 * order spread evenly across every product. */
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

/**
 * Estimate $ earned while away, from a snapshot `state` and the elapsed real
 * time since it was saved. Returns 0 below settings.offline.minSeconds, and
 * clamps elapsedMs to settings.offline.maxHours worth of milliseconds.
 */
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
