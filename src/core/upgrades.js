/**
 * upgrades.js — pure upgrade logic + the view model the Upgrades DOM menu
 * renders (see scene/UpgradeMenu.js). No Three.
 *
 * Two-stage room unlock (garage-wide, "Garage" section):
 *   Expand Room      reveal the next empty lot (roomUnlocked)
 *   Buy Pit Equipment install the repair station on a lot (equipped)
 * Per-pit upgrades (once equipped, "Workers" section):
 *   Hire Worker      one-time -> hasMechanic (auto-repair + remote hurry)
 *   Worker Speed     ticks/sec the worker auto-adds (shown once hired)
 *   Fixing Time      lowers fixTimeFactor -> fewer required ticks
 *
 * All costs are geometric: cost = baseCost × costGrowth^level.
 */
import settings from '../config/settings.js';
import { formatMoney } from './format.js';

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

// --- room footprint (Expand Room actually grows the room) -----------------
//
// The bay row sits behind a fence that slides right as land is bought, so an
// unpurchased pit is physically unreachable, not just visually hidden. The
// shared lane (z <= BAY_ZONE_Z) is already-built infrastructure and is never
// fenced. Pit positions are fixed (settings.pit.positions); only the fence's
// own x position is derived from how much land is currently owned.

const LOT_HALF_WIDTH = 2.1; // half of PitView's lot/station plane width (4.2)
const BAY_MARGIN = 13.5; // gap from an owned lot's outer edge to the fence
export const BAY_ZONE_Z = -0.75; // z beyond this is bay territory (fenced); below it is the open lane

/** True once every pit's land has been bought (no fence left to show). */
export function allLandOwned(state) {
  return state.pits.every((p) => p.roomUnlocked);
}

/**
 * Rightmost X currently owned in the bay row (where the fence sits). Grows
 * each time Expand Room is bought; capped at the room's outer wall once all
 * land is owned.
 */
export function ownedRightX(state) {
  const unlockedCount = state.pits.filter((p) => p.roomUnlocked).length;
  const lastIndex = Math.max(0, unlockedCount - 1);
  const raw = settings.pit.positions[lastIndex].x + LOT_HALF_WIDTH + BAY_MARGIN;
  return Math.min(raw, settings.world.halfX);
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

/** Flat, one-time cost of the garage-wide cashier hire. */
export function cashierCost(state) {
  return U.cashier.baseCost;
}

/** Flat, one-time cost of the garage-wide conveyor automation. */
export function conveyorCost(state) {
  return settings.storage.conveyorBaseCost;
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

/**
 * Hire the garage-wide cashier (one-time). Future payouts skip the per-pit
 * waiting pile and land straight in cash; any money already waiting at pits is
 * swept in on hire so nothing is left stranded.
 */
export function buyCashier(state) {
  if (state.hasCashier) return false;
  const cost = cashierCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.hasCashier = true;
  for (const pit of state.pits) {
    if (pit.pendingCash > 0) {
      state.cash += pit.pendingCash;
      pit.pendingCash = 0;
    }
  }
  return true;
}

/**
 * Buy the garage-wide conveyor (one-time). From then on every pit's shelf
 * auto-delivers boxes to its tire stack on a timer (see simulation.updateStorage),
 * so tires never have to be hand-carried.
 */
export function buyConveyor(state) {
  if (state.hasConveyor) return false;
  const cost = conveyorCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.hasConveyor = true;
  return true;
}

// --- view model for the Upgrades DOM menu ---------------------------------
//
// Two sections: Garage (Expand Room + Buy Pit Equipment for any
// roomUnlocked-but-unequipped pit) and Workers (one sub-block per *equipped*
// pit — Hire Worker until hired, then Worker Speed; Fixing Time always shows).

/** Reference car for showing Fixing Time as a concrete tick count (3 parts). */
const REF_BASE_TICKS = settings.repair.ticksPerPart * 3;

export function getMenuModel(state) {
  return {
    garage: garageRows(state),
    cashier: [cashierRow(state)],
    automation: [conveyorRow(state)],
    workers: state.pits.filter((p) => p.equipped).map((p) => workerBlock(state, p)),
  };
}

function garageRows(state) {
  const rows = [expandView(state)];
  for (const pit of state.pits) {
    if (pit.roomUnlocked && !pit.equipped) rows.push(equipmentView(state, pit));
  }
  return rows;
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
    cost: `$${formatMoney(cost)}`,
    disabled: state.cash < cost,
  };
}

/** Cashier section: the one-time garage-wide hire that auto-banks every payout. */
function cashierRow(state) {
  if (state.hasCashier) {
    return {
      kind: 'cashier',
      label: 'Cashier',
      effect: 'Auto-banks every payout',
      cost: 'HIRED',
      disabled: true,
    };
  }
  const cost = cashierCost(state);
  return {
    kind: 'cashier',
    label: 'Hire Cashier',
    effect: 'Payouts skip the pit, go straight to cash',
    cost: `$${formatMoney(cost)}`,
    disabled: state.cash < cost,
  };
}

/** Automation section: the one-time conveyor that auto-restocks every pit's tires. */
function conveyorRow(state) {
  if (state.hasConveyor) {
    return {
      kind: 'conveyor',
      label: 'Conveyor',
      effect: 'Auto-restocks tires at every pit',
      cost: 'OWNED',
      disabled: true,
    };
  }
  const cost = conveyorCost(state);
  return {
    kind: 'conveyor',
    label: 'Buy Conveyor',
    effect: 'Auto-delivers boxes → tires, hands-free',
    cost: `$${formatMoney(cost)}`,
    disabled: state.cash < cost,
  };
}

function equipmentView(state, pit) {
  const cost = pitEquipmentCost(state, pit.index);
  return {
    kind: 'equipment',
    pitIndex: pit.index,
    label: `Equip Pit ${letter(pit.index)}`,
    effect: 'Install repair station',
    cost: `$${formatMoney(cost)}`,
    disabled: state.cash < cost,
  };
}

function workerBlock(state, pit) {
  const L = letter(pit.index);
  const rows = [];

  if (!pit.hasMechanic) {
    rows.push(hireView(state, pit));
  } else {
    rows.push(workerSpeedRow(state, pit));
  }
  rows.push(fixingTimeRow(state, pit));

  return { index: pit.index, title: `Worker ${L}`, rows };
}

function hireView(state, pit) {
  const cost = hireCost(state, pit.index);
  return {
    kind: 'hire',
    pitIndex: pit.index,
    label: 'Hire Worker',
    effect: 'Auto-repairs this pit',
    cost: `$${formatMoney(cost)}`,
    disabled: state.cash < cost,
  };
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
    cost: `$${formatMoney(cost)}`,
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
    cost: `$${formatMoney(cost)}`,
    disabled: state.cash < cost,
  };
}
