/**
 * upgrades.js — pure upgrade logic + the view data the DOM menu renders. No Three.
 *
 *   Mechanic     one-time hire -> hasMechanic (enables auto-repair + hurry)
 *   Worker Speed mechanic auto-repair rate (locked until a mechanic exists)
 *   Fixing Time  reduces work-per-car (helps manual taps AND the mechanic)
 */
import settings from '../config/settings.js';

const U = settings.upgrades;

// --- effects consumed by the simulation ----------------------------------

export function mechanicRate(state) {
  return U.workerSpeed.baseRate + state.upgrades.workerSpeed * U.workerSpeed.ratePerLevel;
}

/** Multiplier (<= 1) applied to a new car's work. Higher fixingTime = less work. */
export function fixingWorkMult(state) {
  return 1 / (1 + state.upgrades.fixingTime * U.fixingTime.workMultPerLevel);
}

// --- cost / availability --------------------------------------------------

export function upgradeCost(state, id) {
  if (id === 'mechanic') return state.upgrades.hasMechanic ? null : U.mechanic.cost;
  const u = U[id];
  const level = state.upgrades[id];
  if (level >= u.maxLevel) return null;
  return Math.round(u.baseCost * Math.pow(u.costGrowth, level));
}

export function upgradeAvailable(state, id) {
  if (id === 'mechanic') return !state.upgrades.hasMechanic;
  if (id === 'workerSpeed' && !state.upgrades.hasMechanic) return false;
  return state.upgrades[id] < U[id].maxLevel;
}

export function buyUpgrade(state, id) {
  if (!upgradeAvailable(state, id)) return false;
  const cost = upgradeCost(state, id);
  if (cost == null || state.cash < cost) return false;

  state.cash -= cost;
  if (id === 'mechanic') state.upgrades.hasMechanic = true;
  else state.upgrades[id] += 1;
  return true;
}

// --- view data for the menu ----------------------------------------------

export function getUpgradeViews(state) {
  return [mechanicView(state), workerSpeedView(state), fixingTimeView(state)];
}

function mechanicView(state) {
  if (state.upgrades.hasMechanic) {
    return { id: 'mechanic', label: 'Mechanic', effect: 'On the job', cost: 'Hired', disabled: true };
  }
  const c = U.mechanic.cost;
  return {
    id: 'mechanic',
    label: 'Mechanic',
    effect: 'Auto-repairs the pit',
    cost: `$${c}`,
    disabled: state.cash < c,
  };
}

function workerSpeedView(state) {
  const rate = mechanicRate(state);
  if (!state.upgrades.hasMechanic) {
    return {
      id: 'workerSpeed',
      label: 'Worker Speed',
      effect: `${rate}/s`,
      cost: 'Need mechanic',
      disabled: true,
    };
  }
  if (state.upgrades.workerSpeed >= U.workerSpeed.maxLevel) {
    return { id: 'workerSpeed', label: 'Worker Speed', effect: `${rate}/s`, cost: 'MAX', disabled: true };
  }
  const c = upgradeCost(state, 'workerSpeed');
  return {
    id: 'workerSpeed',
    label: 'Worker Speed',
    effect: `${rate}/s → ${rate + U.workerSpeed.ratePerLevel}/s`,
    cost: `$${c}`,
    disabled: state.cash < c,
  };
}

function fixingTimeView(state) {
  const level = state.upgrades.fixingTime;
  const pct = Math.round(level * U.fixingTime.workMultPerLevel * 100);
  if (level >= U.fixingTime.maxLevel) {
    return { id: 'fixingTime', label: 'Fixing Time', effect: `+${pct}% faster`, cost: 'MAX', disabled: true };
  }
  const nextPct = Math.round((level + 1) * U.fixingTime.workMultPerLevel * 100);
  const c = upgradeCost(state, 'fixingTime');
  return {
    id: 'fixingTime',
    label: 'Fixing Time',
    effect: `+${pct}% → +${nextPct}%`,
    cost: `$${c}`,
    disabled: state.cash < c,
  };
}
