/**
 * reputation.js — biases incoming cars toward higher-paying "better" cars
 * (see Car.js spawnCar). Two ways up:
 *   buyAdvertising   permanent +repStep, geometric cost (cost = adBaseCost × adGrowth^adLevel)
 *   activateRepBoost temporary ×boostMultiplier for boostDurationSeconds (no stacking)
 * No Three.js.
 */
import settings from '../config/settings.js';
import { formatMoney } from './format.js';

const R = settings.reputation;

const adCostAt = (level) => Math.round(R.adBaseCost * Math.pow(R.adGrowth, level));

/** Permanent rate, ×boostMultiplier while a rewarded-ad boost is active, capped at repCap. */
export function getEffectiveReputation(state) {
  const mult = state.repBoostRemaining > 0 ? R.boostMultiplier : 1;
  return Math.min(R.repCap, state.permanentReputation * mult);
}

export function adCost(state) {
  return adCostAt(state.adLevel);
}

/** Permanent +repStep to reputation; cost scales with how many times it's been bought. */
export function buyAdvertising(state) {
  if (state.permanentReputation >= R.repCap) return false;
  const cost = adCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.permanentReputation = Math.min(R.repCap, state.permanentReputation + R.repStep);
  state.adLevel += 1;
  return true;
}

/** Rewarded-ad boost. Refuses to re-arm while one is already running (no stacking). */
export function activateRepBoost(state) {
  if (state.repBoostRemaining > 0) return;
  state.repBoostRemaining = R.boostDurationSeconds;
}

/** Called from simulation.tick(): counts the boost window down to 0. */
export function updateReputationTimer(state, dt) {
  if (state.repBoostRemaining > 0) state.repBoostRemaining = Math.max(0, state.repBoostRemaining - dt);
}

// --- view model for the Advertising DOM panel ------------------------------

export function getReputationMenuModel(state) {
  const boostActive = state.repBoostRemaining > 0;
  const atCap = state.permanentReputation >= R.repCap;
  const cost = adCost(state);
  return {
    permanentPct: Math.round(state.permanentReputation * 100),
    effectivePct: Math.round(getEffectiveReputation(state) * 100),
    boostActive,
    boostRemaining: state.repBoostRemaining,
    atCap,
    adCostLabel: atCap ? 'MAX' : `$${formatMoney(cost)}`,
    adDisabled: atCap || state.cash < cost,
  };
}
