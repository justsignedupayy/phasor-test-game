/**
 * reputation.js — biases incoming cars toward higher-paying "better" cars
 * (see Car.js spawnCar). Two ways up, BOTH permanent:
 *   buyAdvertising        permanent +repStep, geometric cash cost (cost = adBaseCost × adGrowth^adLevel)
 *   watchAdForReputation  permanent +adRewardStep for free, then a fixed cooldown (adCooldownSeconds)
 * No Three.js.
 */
import settings from '../config/settings.js';
import { formatMoney } from './format.js';

const R = settings.reputation;

const adCostAt = (level) => Math.round(R.adBaseCost * Math.pow(R.adGrowth, level));

/** Current reputation, capped at repCap (no temporary multiplier any more). */
export function getEffectiveReputation(state) {
  return Math.min(R.repCap, state.permanentReputation);
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

/**
 * Rewarded-ad reward: grants a PERMANENT +adRewardStep reputation (free), then
 * arms the Watch Ad cooldown. Refuses while on cooldown or already at repCap.
 * Returns true if the reward applied.
 */
export function watchAdForReputation(state) {
  if (state.adCooldownRemaining > 0) return false;
  if (state.permanentReputation >= R.repCap) return false;
  state.permanentReputation = Math.min(R.repCap, state.permanentReputation + R.adRewardStep);
  state.adCooldownRemaining = R.adCooldownSeconds;
  return true;
}

/** Called from simulation.tick(): counts the Watch Ad cooldown down to 0. */
export function updateReputationTimer(state, dt) {
  if (state.adCooldownRemaining > 0) {
    state.adCooldownRemaining = Math.max(0, state.adCooldownRemaining - dt);
  }
}

// --- view model for the Advertising DOM panel ------------------------------

export function getReputationMenuModel(state) {
  const atCap = state.permanentReputation >= R.repCap;
  const cost = adCost(state);
  const onCooldown = state.adCooldownRemaining > 0;
  return {
    permanentPct: Math.round(state.permanentReputation * 100),
    effectivePct: Math.round(getEffectiveReputation(state) * 100),
    atCap,
    adCostLabel: atCap ? 'MAX' : `$${formatMoney(cost)}`,
    adDisabled: atCap || state.cash < cost,
    // Watch Ad (rewarded, permanent +adRewardStep, then cooldown):
    watchRewardPct: Math.round(R.adRewardStep * 100),
    watchOnCooldown: onCooldown,
    watchCooldownRemaining: state.adCooldownRemaining,
    watchDisabled: atCap || onCooldown,
  };
}
