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
import { createMarketWorker } from './supermarket.js';
import { breakDuration } from './breaks.js';
import { roomWallBox } from './collision.js';
import { rebuildGrid } from './pathfinding.js';

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

/** Flat, one-time cost of a single worker's "Upgrade Break Room" (per worker). */
export function breakRoomCost(state) {
  return U.breakRoom.baseCost;
}

/** Flat, one-time cost of the garage-wide mechanic auto-restock upgrade. */
export function autoRestockCost(state) {
  return settings.storage.autoRestockBaseCost;
}

/** Flat, one-time cost to unlock the supermarket. */
export function supermarketCost(state) {
  return settings.supermarket.unlockBaseCost;
}

/** Flat, one-time cost of the level 0 -> 1 market worker hire. */
export function marketWorkerHireCost(state) {
  return settings.supermarket.workerHireCost;
}

/** Flat, one-time cost of the level 1 -> 2 market worker training. */
export function marketWorkerTrainCost(state) {
  return settings.supermarket.workerTrainCost;
}

/** Highest truck-frequency level (last interval in the array). */
const TRUCK_MAX_LEVEL = settings.supermarket.truck.intervals.length - 1;

/** Geometric cost of the next "Faster Deliveries" level. */
export function truckFrequencyCost(state) {
  return geoCost(U.truckFrequency, state.supermarket.truckUpgradeLevel);
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
  // The fence wall just slid right (ownedRightX changed) — re-block the A* grid so
  // NPCs route around its new position immediately (see core/pathfinding.rebuildGrid).
  rebuildGrid([roomWallBox(ownedRightX(state))]);
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
 * Upgrade a pit mechanic's break room (one-time, per worker): halves that
 * worker's break duration and swaps its chair for a couch. Requires the pit to
 * have a hired mechanic. See core/breaks.js (breakDurationUpgraded).
 */
export function buyBreakRoom(state, pitIndex) {
  const pit = state.pits[pitIndex];
  if (!pit || !pit.hasMechanic || pit.break.breakDurationUpgraded) return false;
  const cost = breakRoomCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pit.break.breakDurationUpgraded = true;
  return true;
}

/** Upgrade the market worker's break room (one-time): halves its break duration. */
export function buyMarketBreakRoom(state) {
  const w = state.supermarket.worker;
  if (!w || w.break.breakDurationUpgraded) return false;
  const cost = breakRoomCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  w.break.breakDurationUpgraded = true;
  return true;
}

/**
 * Buy the garage-wide mechanic auto-restock upgrade (one-time). From then on each
 * pit's hired mechanic fetches a box from its own shelf and refills its tire stack
 * itself when it runs dry (see simulation.updateMechanic), so tires never have to be
 * hand-carried.
 */
export function buyAutoRestock(state) {
  if (state.autoRestock) return false;
  const cost = autoRestockCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.autoRestock = true;
  return true;
}

/** Unlock the supermarket (one-time). Shelves start full; no worker yet. */
export function buySupermarket(state) {
  if (state.supermarket.unlocked) return false;
  const cost = supermarketCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.supermarket.unlocked = true;
  return true;
}

/** Hire the market worker (level 0 -> 1): it takes over packaging. */
export function hireMarketWorker(state) {
  if (!state.supermarket.unlocked || state.supermarket.workerLevel !== 0) return false;
  const cost = marketWorkerHireCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.supermarket.workerLevel = 1;
  state.supermarket.worker = createMarketWorker();
  return true;
}

/** Train the market worker (level 1 -> 2): it also takes over restocking. */
export function trainMarketWorker(state) {
  if (state.supermarket.workerLevel !== 1) return false;
  const cost = marketWorkerTrainCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.supermarket.workerLevel = 2;
  return true;
}

/** Buy the next "Faster Deliveries" level: speeds up the restock truck (global). */
export function buyTruckFrequency(state) {
  const S = state.supermarket;
  if (!S.unlocked || S.truckUpgradeLevel >= TRUCK_MAX_LEVEL) return false;
  const cost = truckFrequencyCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  S.truckUpgradeLevel += 1;
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
    automation: [autoRestockRow(state)],
    supermarket: supermarketRows(state),
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

/** Automation section: the one-time upgrade that lets each pit's mechanic auto-restock. */
function autoRestockRow(state) {
  if (state.autoRestock) {
    return {
      kind: 'autoRestock',
      label: 'Mechanic Auto-Restock',
      effect: 'Mechanics refill their own pits',
      cost: 'OWNED',
      disabled: true,
    };
  }
  const cost = autoRestockCost(state);
  return {
    kind: 'autoRestock',
    label: 'Mechanic Auto-Restock',
    effect: 'Mechanics fetch boxes & restock, hands-free',
    cost: `$${formatMoney(cost)}`,
    disabled: state.cash < cost,
  };
}

/** Supermarket section: unlock, the 2-level worker upgrade, then (once a worker
 * exists) its own break-room upgrade row. */
function supermarketRows(state) {
  const S = state.supermarket;

  if (!S.unlocked) {
    const cost = supermarketCost(state);
    return [
      {
        kind: 'openMarket',
        label: 'Open Supermarket',
        effect: 'Turns the lobby into a shop',
        cost: `$${formatMoney(cost)}`,
        disabled: state.cash < cost,
      },
    ];
  }

  const rows = [];
  if (S.workerLevel === 0) {
    const cost = marketWorkerHireCost(state);
    rows.push({
      kind: 'hireMarketWorker',
      label: 'Hire Market Worker',
      effect: 'Worker packages orders; you still restock',
      cost: `$${formatMoney(cost)}`,
      disabled: state.cash < cost,
    });
  } else if (S.workerLevel === 1) {
    const cost = marketWorkerTrainCost(state);
    rows.push({
      kind: 'trainMarketWorker',
      label: 'Train Market Worker',
      effect: 'Worker also restocks, hands-free',
      cost: `$${formatMoney(cost)}`,
      disabled: state.cash < cost,
    });
  } else {
    rows.push({
      kind: 'trainMarketWorker',
      label: 'Market Worker',
      effect: 'Fully trained — packages and restocks',
      cost: 'MAX',
      disabled: true,
    });
  }

  // Once a market worker is hired (level >= 1) it takes breaks, so its break
  // room can be upgraded — the market counterpart of each pit worker's row.
  if (S.worker) rows.push(breakRoomRow(state, S.worker.break, 'marketBreakRoom', undefined));

  // Global restock-truck frequency upgrade (always shown once the market is open).
  rows.push(truckFrequencyRow(state));

  return rows;
}

/**
 * The "Faster Deliveries" row: steps the restock-truck interval down a level. The
 * label is constant (only effect/cost refresh live in the menu without a rebuild);
 * the level number rides the effect line, like Worker Speed / Fixing Time.
 */
const ROMAN = ['I', 'II', 'III'];
function truckFrequencyRow(state) {
  const intervals = settings.supermarket.truck.intervals;
  const lvl = state.supermarket.truckUpgradeLevel;
  const cur = intervals[Math.min(lvl, intervals.length - 1)];
  if (lvl >= TRUCK_MAX_LEVEL) {
    return { kind: 'truckFrequency', label: 'Faster Deliveries', effect: `Truck every ${cur}s`, cost: 'MAX', disabled: true };
  }
  const cost = truckFrequencyCost(state);
  return {
    kind: 'truckFrequency',
    label: 'Faster Deliveries',
    effect: `${ROMAN[lvl]}: truck ${cur}s → ${intervals[lvl + 1]}s`,
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
  // A hired worker takes breaks, so it can have its break room upgraded.
  if (pit.hasMechanic) rows.push(breakRoomRow(state, pit.break, 'breakRoom', pit.index));

  return { index: pit.index, title: `Worker ${L}`, rows };
}

/** Seconds, no decimals, for a break-duration readout. */
const fmtSecs = (s) => `${Math.round(s)}s`;

/**
 * A per-worker "Upgrade Break Room" row (one-time): halves the break duration.
 * Shared by the pit mechanics (kind 'breakRoom', with a pitIndex) and the market
 * worker (kind 'marketBreakRoom', no pitIndex). `b` is that worker's break state.
 */
function breakRoomRow(state, b, kind, pitIndex) {
  const cur = breakDuration(b);
  if (b.breakDurationUpgraded) {
    return { kind, pitIndex, label: 'Break Room', effect: `Break: ${fmtSecs(cur)}`, cost: 'MAX', disabled: true };
  }
  const cost = breakRoomCost(state);
  return {
    kind,
    pitIndex,
    label: 'Upgrade Break Room',
    effect: `Break: ${fmtSecs(cur)} → ${fmtSecs(settings.breakDurations.upgraded)}`,
    cost: `$${formatMoney(cost)}`,
    disabled: state.cash < cost,
  };
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
