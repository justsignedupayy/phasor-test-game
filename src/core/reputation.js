import settings from '../config/settings.js';
import { formatMoney } from './format.js';

const R = settings.reputation;

const adCostAt = (level) => Math.round(R.adBaseCost * Math.pow(R.adGrowth, level));

export function getEffectiveReputation(state) {
  return Math.min(R.repCap, state.permanentReputation);
}

export function adCost(state) {
  return adCostAt(state.adLevel);
}

export function buyAdvertising(state) {
  if (state.permanentReputation >= R.repCap) return false;
  const cost = adCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.permanentReputation = Math.min(R.repCap, state.permanentReputation + R.repStep);
  state.adLevel += 1;
  return true;
}

export function watchAdForReputation(state) {
  if (state.adCooldownRemaining > 0) return false;
  if (state.permanentReputation >= R.repCap) return false;
  state.permanentReputation = Math.min(R.repCap, state.permanentReputation + R.adRewardStep);
  state.adCooldownRemaining = R.adCooldownSeconds;
  return true;
}

export function updateReputationTimer(state, dt) {
  if (state.adCooldownRemaining > 0) {
    state.adCooldownRemaining = Math.max(0, state.adCooldownRemaining - dt);
  }
}

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
    watchRewardPct: Math.round(R.adRewardStep * 100),
    watchOnCooldown: onCooldown,
    watchCooldownRemaining: state.adCooldownRemaining,
    watchDisabled: atCap || onCooldown,
  };
}
