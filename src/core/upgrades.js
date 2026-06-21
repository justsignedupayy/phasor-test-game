/**
 * upgrades.js — pure upgrade logic + the view model the DOM menu renders. No Three.
 *
 * Two-stage room unlock (garage-wide):
 *   Expand Room      reveal the next empty lot (roomUnlocked)
 *   Buy Pit Equipment install the repair station on a lot (equipped)
 * Per-pit upgrades (once equipped):
 *   Hire Worker      one-time -> hasMechanic (auto-repair + remote hurry)
 *   Worker Speed     ticks/sec the worker auto-adds
 *   Fixing Time      lowers fixTimeFactor -> fewer required ticks
 *
 * All costs are geometric: cost = baseCost × costGrowth^level.
 */
import settings from '../config/settings.js';

const U = settings.upgrades;

const geoCost = (cfg, level) => Math.round(cfg.baseCost * Math.pow(cfg.costGrowth, level));
const letter = (i) => String.fromCharCode(65 + i); // 0 -> "A"
const fmtRate = (r) => (Number.isInteger(r) ? `${r}` : r.toFixed(1));

// --- derived per-pit effects (consumed by the simulation + views) ---------

/** Worker auto-repair rate in ticks/sec. */
export function workerSpeed(pit) {
  return U.workerSpeed.baseRate + pit.workerSpeedLevel * U.workerSpeed.ratePerLevel;
}

/** Fix-time factor (<= 1) for a given level; floored. */
function factorAt(level) {
  return Math.max(U.fixingTime.factorFloor, 1 - level * U.fixingTime.factorPerLevel);
}

/** This pit's current fix-time factor (<= 1). Lower = fewer required ticks. */
export function fixTimeFactor(pit) {
  return factorAt(pit.fixingTimeLevel);
}

/** Ticks this pit actually needs to finish a given car. */
export function requiredTicks(car, pit) {
  return car.baseTicks * fixTimeFactor(pit);
}

// --- costs ----------------------------------------------------------------

/** Cost of the next Expand Room (geometric in how many lots are already open). */
export function expandRoomCost(state) {
  const opened = state.pits.filter((p) => p.roomUnlocked).length;
  return geoCost(U.expandRoom, opened - 1); // first paid expansion is level 0
}

export function pitEquipmentCost(state, pitIndex) {
  return geoCost(U.pitEquipment, pitIndex);
}

export function hireCost(state, pitIndex) {
  return geoCost(U.mechanic, pitIndex);
}

export function workerSpeedCost(state, pit) {
  return geoCost(U.workerSpeed, pit.workerSpeedLevel);
}

export function fixingTimeCost(state, pit) {
  return geoCost(U.fixingTime, pit.fixingTimeLevel);
}

// --- purchases ------------------------------------------------------------

/** Unlock the lowest-index locked lot (empty floor space only). */
export function buyExpandRoom(state) {
  const next = state.pits.find((p) => !p.roomUnlocked);
  if (!next) return false;
  const cost = expandRoomCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  next.roomUnlocked = true;
  return true;
}

/** Install the repair station on a roomUnlocked-but-unequipped pit. */
export function buyPitEquipment(state, pitIndex) {
  const pit = state.pits[pitIndex];
  if (!pit || !pit.roomUnlocked || pit.equipped) return false;
  const cost = pitEquipmentCost(state, pitIndex);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pit.equipped = true;
  return true;
}

/** One-time worker hire; requires the pit to be equipped. */
export function hireMechanic(state, pitIndex) {
  const pit = state.pits[pitIndex];
  if (!pit || !pit.equipped || pit.hasMechanic) return false;
  const cost = hireCost(state, pitIndex);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pit.hasMechanic = true;
  return true;
}

export function buyWorkerSpeed(state, pitIndex) {
  const pit = state.pits[pitIndex];
  if (!pit || !pit.equipped || pit.workerSpeedLevel >= U.workerSpeed.maxLevel) return false;
  const cost = workerSpeedCost(state, pit);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pit.workerSpeedLevel += 1;
  return true;
}

export function buyFixingTime(state, pitIndex) {
  const pit = state.pits[pitIndex];
  if (!pit || !pit.equipped || pit.fixingTimeLevel >= U.fixingTime.maxLevel) return false;
  const cost = fixingTimeCost(state, pit);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pit.fixingTimeLevel += 1;
  return true;
}

// --- view model for the DOM menu -----------------------------------------

/** Reference car for showing Fixing Time as a concrete tick count (3 parts). */
const REF_BASE_TICKS = settings.repair.ticksPerPart * 3;

export function getMenuModel(state) {
  return {
    expand: expandView(state),
    pits: state.pits.filter((p) => p.roomUnlocked).map((p) => pitBlock(state, p)),
  };
}

function expandView(state) {
  const next = state.pits.find((p) => !p.roomUnlocked);
  if (!next) {
    return { kind: 'expand', label: 'Expand Room', effect: 'All lots open', cost: 'MAX', disabled: true };
  }
  const cost = expandRoomCost(state);
  return {
    kind: 'expand',
    label: 'Expand Room',
    effect: `Open lot ${letter(next.index)}`,
    cost: `$${cost}`,
    disabled: state.cash < cost,
  };
}

function pitBlock(state, pit) {
  const L = letter(pit.index);
  const block = { index: pit.index, title: `Pit ${L} / Worker ${L}`, equipped: pit.equipped, rows: [] };

  if (!pit.equipped) {
    const cost = pitEquipmentCost(state, pit.index);
    block.rows.push({
      kind: 'equipment',
      pitIndex: pit.index,
      label: 'Buy Pit Equipment',
      effect: 'Install repair station',
      cost: `$${cost}`,
      disabled: state.cash < cost,
    });
    return block;
  }

  if (!pit.hasMechanic) {
    const cost = hireCost(state, pit.index);
    block.rows.push({
      kind: 'hire',
      pitIndex: pit.index,
      label: 'Hire Worker',
      effect: 'Auto-repairs this pit',
      cost: `$${cost}`,
      disabled: state.cash < cost,
    });
  }

  block.rows.push(workerSpeedRow(state, pit));
  block.rows.push(fixingTimeRow(state, pit));
  return block;
}

function workerSpeedRow(state, pit) {
  const cur = workerSpeed(pit);
  if (pit.workerSpeedLevel >= U.workerSpeed.maxLevel) {
    return {
      kind: 'workerSpeed',
      pitIndex: pit.index,
      label: 'Worker Speed',
      effect: `${fmtRate(cur)}/s`,
      cost: 'MAX',
      disabled: true,
    };
  }
  const cost = workerSpeedCost(state, pit);
  const next = cur + U.workerSpeed.ratePerLevel;
  return {
    kind: 'workerSpeed',
    pitIndex: pit.index,
    label: 'Worker Speed',
    effect: `${fmtRate(cur)} → ${fmtRate(next)}/s`,
    cost: `$${cost}`,
    disabled: state.cash < cost,
  };
}

function fixingTimeRow(state, pit) {
  const cur = Math.round(REF_BASE_TICKS * fixTimeFactor(pit));
  if (pit.fixingTimeLevel >= U.fixingTime.maxLevel) {
    return {
      kind: 'fixingTime',
      pitIndex: pit.index,
      label: 'Fixing Time',
      effect: `Fix time: ${cur} ticks`,
      cost: 'MAX',
      disabled: true,
    };
  }
  const next = Math.round(REF_BASE_TICKS * factorAt(pit.fixingTimeLevel + 1));
  const cost = fixingTimeCost(state, pit);
  return {
    kind: 'fixingTime',
    pitIndex: pit.index,
    label: 'Fixing Time',
    effect: `Fix time: ${cur} → ${next}`,
    cost: `$${cost}`,
    disabled: state.cash < cost,
  };
}
