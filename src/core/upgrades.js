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

/** Attendant auto-fill rate in ticks/sec — workerSpeed's gas-station mirror. */
export function attendantSpeed(pump) {
  return U.gas.workerSpeed.baseRate + pump.workerSpeedLevel * U.gas.workerSpeed.ratePerLevel;
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

// Gas-station costs, mirroring the pit set (geometric, same level choices).

/**
 * Cost of the next Expand Station (geometric in how many pump lots are open).
 * Unlike expandRoomCost there is no free starter lot — the very first purchase
 * (opening pump lot 0, i.e. the whole station) is level 0.
 */
export function gasExpandCost(state) {
  const opened = state.gasStation.pumps.filter((p) => p.roomUnlocked).length;
  return geoCost(U.gas.expand, opened);
}

export function gasEquipmentCost(state, pumpIndex) {
  return geoCost(U.gas.equipment, pumpIndex);
}

export function attendantHireCost(state, pumpIndex) {
  return geoCost(U.gas.attendant, pumpIndex);
}

export function attendantSpeedCost(state, pump) {
  return geoCost(U.gas.workerSpeed, pump.workerSpeedLevel);
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

/**
 * Reputation gate for opening pit `pitIndex`'s land (settings.pit.unlockReputation,
 * a fraction of repCap). Gated on PERMANENT reputation — a temporary rewarded-ad
 * boost never unlocks land. Reputation only ever rises, so gating Expand Room
 * alone covers the whole two-stage unlock (equipment needs roomUnlocked first).
 */
export function pitReputationMet(state, pitIndex) {
  const need = settings.pit.unlockReputation[pitIndex] ?? 0;
  return state.permanentReputation >= need - 1e-9; // epsilon: rep accrues in float steps
}

/** Unlock the lowest-index locked lot (empty floor space only). Requires BOTH the
 * cash cost AND that lot's reputation threshold (pitReputationMet). */
export function buyExpandRoom(state) {
  const next = state.pits.find((p) => !p.roomUnlocked);
  if (!next) return false;
  if (!pitReputationMet(state, next.index)) return false;
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

// Gas-station purchases, mirroring the pit set 1:1. The pump row sits outside
// the building (no fence wall to slide, no A* territory), so opening a lot has
// no grid/wall side effects — just the flag flip.

/**
 * The gas station is endgame content: its FIRST purchase (buying the station,
 * i.e. opening pump lot 0) is locked until the garage and the supermarket are
 * fully built out. Returns { ready, missing } where missing is a short label per
 * unmet requirement (shown on the Open Gas Station menu row).
 *
 * Garage complete = every pit's land bought + equipped, a mechanic hired on all
 * five, and every pit's Worker Speed + Fixing Time at max level. Market complete
 * = supermarket open, its worker hired AND trained, and Faster Deliveries maxed.
 * Break-room upgrades are worker comfort, not production, and don't gate.
 */
export function gasStationPrereqs(state) {
  const missing = [];
  const pits = state.pits;
  if (!pits.every((p) => p.roomUnlocked && p.equipped)) missing.push('open + equip all 5 pits');
  if (!pits.every((p) => p.hasMechanic)) missing.push('hire all 5 mechanics');
  if (!pits.every((p) => p.workerSpeedLevel >= U.workerSpeed.maxLevel)) missing.push('max every Worker Speed');
  if (!pits.every((p) => p.fixingTimeLevel >= U.fixingTime.maxLevel)) missing.push('max every Fixing Time');
  const S = state.supermarket;
  if (!S.unlocked) missing.push('open the supermarket');
  if (S.workerLevel < 2) missing.push('hire + train the market worker');
  if (S.truckUpgradeLevel < TRUCK_MAX_LEVEL) missing.push('max Faster Deliveries');
  return { ready: missing.length === 0, missing };
}

/**
 * Open the lowest-index locked pump lot (empty ground only) — buyExpandRoom's
 * mirror. The FIRST purchase (lot 0 = the whole station) additionally requires
 * gasStationPrereqs; later lots are gated on cash alone, like Expand Room.
 */
export function buyGasExpand(state) {
  const next = state.gasStation.pumps.find((p) => !p.roomUnlocked);
  if (!next) return false;
  if (next.index === 0 && !gasStationPrereqs(state).ready) return false;
  const cost = gasExpandCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  next.roomUnlocked = true;
  return true;
}

/** Install the pump on an opened-but-unequipped lot — buyPitEquipment's mirror. */
export function buyGasEquipment(state, pumpIndex) {
  const pump = state.gasStation.pumps[pumpIndex];
  if (!pump || !pump.roomUnlocked || pump.equipped) return false;
  const cost = gasEquipmentCost(state, pumpIndex);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pump.equipped = true;
  return true;
}

/** One-time attendant hire; requires the pump to be equipped — hireMechanic's mirror. */
export function hireAttendant(state, pumpIndex) {
  const pump = state.gasStation.pumps[pumpIndex];
  if (!pump || !pump.equipped || pump.hasAttendant) return false;
  const cost = attendantHireCost(state, pumpIndex);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pump.hasAttendant = true;
  return true;
}

/** Per-pump attendant speed level — buyWorkerSpeed's mirror. */
export function buyAttendantSpeed(state, pumpIndex) {
  const pump = state.gasStation.pumps[pumpIndex];
  if (!pump || !pump.equipped || pump.workerSpeedLevel >= U.gas.workerSpeed.maxLevel) return false;
  const cost = attendantSpeedCost(state, pump);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pump.workerSpeedLevel += 1;
  return true;
}

/**
 * Upgrade a pump attendant's break room (one-time, per worker): halves that
 * attendant's break duration and swaps its chair for a couch — buyBreakRoom's
 * mirror, same flat cost.
 */
export function buyGasBreakRoom(state, pumpIndex) {
  const pump = state.gasStation.pumps[pumpIndex];
  if (!pump || !pump.hasAttendant || pump.break.breakDurationUpgraded) return false;
  const cost = breakRoomCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pump.break.breakDurationUpgraded = true;
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
  for (const pit of [...state.pits, ...state.gasStation.pumps]) {
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

// --- physical unlock markers (world-space purchases) ------------------------
//
// Every "create a location / hire a worker" purchase happens IN the world, not
// in the phone menu: a white ground circle + cost label at the spot the purchase
// creates (rendered by scene/UnlockMarkers.js, tunables in
// settings.unlockMarkers). This view model lists the currently-available
// markers; buyUnlockMarker routes a tapped marker to the exact buy function the
// old menu row called, so costs and gates (reputation thresholds, gas prereqs,
// cash) are untouched — only the trigger moved. Tuning upgrades (speed, fixing
// time, breaks, training, deliveries, advertising) stay in the menu below.

export function getUnlockMarkers(state) {
  const M = settings.unlockMarkers;
  const markers = [];

  // Expand Room: one marker on the NEXT locked lot's floor (buyExpandRoom always
  // opens the lowest locked index, and the fence sits just past that lot, so the
  // marker is always in reach). Rep-gated lots show locked with the requirement.
  const nextPit = state.pits.find((p) => !p.roomUnlocked);
  if (nextPit) {
    const p = settings.pit.positions[nextPit.index];
    const locked = !pitReputationMet(state, nextPit.index);
    markers.push({
      kind: 'expandRoom',
      index: nextPit.index,
      x: p.x,
      z: p.z,
      cost: expandRoomCost(state),
      locked,
      hint: locked
        ? `Needs ${Math.round(settings.pit.unlockReputation[nextPit.index] * 100)}% reputation`
        : `Buy lot ${letter(nextPit.index)}`,
    });
  }

  for (const pit of state.pits) {
    const p = settings.pit.positions[pit.index];
    if (pit.roomUnlocked && !pit.equipped) {
      markers.push({
        kind: 'pitEquipment',
        index: pit.index,
        x: p.x,
        z: p.z,
        cost: pitEquipmentCost(state, pit.index),
        locked: false,
        hint: `Equip pit ${letter(pit.index)}`,
      });
    }
    if (pit.equipped && !pit.hasMechanic) {
      markers.push({
        kind: 'hireMechanic',
        index: pit.index,
        x: p.x + M.hireOffset.x,
        z: p.z + M.hireOffset.z,
        cost: hireCost(state, pit.index),
        locked: false,
        hint: `Hire worker ${letter(pit.index)}`,
      });
    }
  }

  // Gas: the FIRST lot's marker stands just inside the future gate (the pump row
  // itself is unreachable until the station exists); later lots on their own ground.
  const nextPump = state.gasStation.pumps.find((p) => !p.roomUnlocked);
  if (nextPump) {
    if (nextPump.index === 0) {
      const ready = gasStationPrereqs(state).ready;
      markers.push({
        kind: 'gasExpand',
        index: 0,
        x: -settings.world.halfX + M.gasEntryInset,
        z: settings.gasStation.gateZ,
        cost: gasExpandCost(state),
        locked: !ready,
        hint: ready ? 'Open the gas station' : 'Finish the garage & market first',
      });
    } else {
      const p = settings.gasStation.positions[nextPump.index];
      markers.push({
        kind: 'gasExpand',
        index: nextPump.index,
        x: p.x,
        z: p.z,
        cost: gasExpandCost(state),
        locked: false,
        hint: `Buy pump lot ${nextPump.index + 1}`,
      });
    }
  }
  for (const pump of state.gasStation.pumps) {
    const p = settings.gasStation.positions[pump.index];
    if (pump.roomUnlocked && !pump.equipped) {
      markers.push({
        kind: 'gasEquipment',
        index: pump.index,
        x: p.x,
        z: p.z,
        cost: gasEquipmentCost(state, pump.index),
        locked: false,
        hint: `Install pump ${pump.index + 1}`,
      });
    }
    if (pump.equipped && !pump.hasAttendant) {
      markers.push({
        kind: 'hireAttendant',
        index: pump.index,
        x: p.x + M.hireOffset.x,
        z: p.z + M.hireOffset.z,
        cost: attendantHireCost(state, pump.index),
        locked: false,
        hint: `Hire attendant ${pump.index + 1}`,
      });
    }
  }

  // Market: unlock, then the worker hire, both on the shop floor's centre spot
  // (they can never coexist). The cashier's marker stands at its future register.
  const S = state.supermarket;
  const spot = settings.supermarket.workerIdleSpot;
  if (!S.unlocked) {
    markers.push({ kind: 'openMarket', x: spot.x, z: spot.z, cost: supermarketCost(state), locked: false, hint: 'Open the supermarket' });
  } else if (S.workerLevel === 0) {
    markers.push({ kind: 'hireMarketWorker', x: spot.x, z: spot.z, cost: marketWorkerHireCost(state), locked: false, hint: 'Hire the market worker' });
  }
  if (!state.hasCashier) {
    const c = settings.supermarket.cashRegisterPosition;
    markers.push({ kind: 'hireCashier', x: c.x, z: c.z, cost: cashierCost(state), locked: false, hint: 'Hire the cashier' });
  }

  return markers;
}

/** A tapped marker → the same purchase its old menu row made (same gates). */
export function buyUnlockMarker(state, kind, index) {
  switch (kind) {
    case 'expandRoom':
      return buyExpandRoom(state);
    case 'pitEquipment':
      return buyPitEquipment(state, index);
    case 'hireMechanic':
      return hireMechanic(state, index);
    case 'gasExpand':
      return buyGasExpand(state);
    case 'gasEquipment':
      return buyGasEquipment(state, index);
    case 'hireAttendant':
      return hireAttendant(state, index);
    case 'openMarket':
      return buySupermarket(state);
    case 'hireMarketWorker':
      return hireMarketWorker(state);
    case 'hireCashier':
      return buyCashier(state);
    default:
      return false;
  }
}

// --- view model for the Upgrades DOM menu ---------------------------------
//
// The menu carries ONLY tuning upgrades for things that already exist — every
// create/hire purchase lives at its physical marker (getUnlockMarkers above).
// Sections: Automation, Supermarket (train/breaks/deliveries, once open),
// Workers (one block per equipped pit) and Attendants (per hired pump).

/** Reference car for showing Fixing Time as a concrete tick count (3 parts). */
const REF_BASE_TICKS = settings.repair.ticksPerPart * 3;

export function getMenuModel(state) {
  return {
    automation: [autoRestockRow(state)],
    supermarket: supermarketRows(state),
    workers: state.pits.filter((p) => p.equipped).map((p) => workerBlock(state, p)),
    attendants: state.gasStation.pumps
      .filter((p) => p.equipped)
      .map((p) => attendantBlock(state, p))
      .filter((b) => b.rows.length > 0),
  };
}

function attendantBlock(state, pump) {
  const rows = [];
  // The attendant itself is hired at its pump-side marker; until then this pump
  // has nothing to tune (rows stay empty and the block is filtered out).
  if (pump.hasAttendant) {
    rows.push(attendantSpeedRow(state, pump));
    // A hired attendant takes breaks, so its break room can be upgraded — the
    // same shared row the pit mechanics and market worker use.
    rows.push(breakRoomRow(state, pump.break, 'gasBreakRoom', pump.index));
  }
  return { index: pump.index, title: `Attendant ${pump.index + 1}`, rows };
}

function attendantSpeedRow(state, pump) {
  const cur = attendantSpeed(pump);
  if (pump.workerSpeedLevel >= U.gas.workerSpeed.maxLevel) {
    return {
      kind: 'attendantSpeed',
      pitIndex: pump.index,
      label: 'Attendant Speed',
      effect: `${fmtRate(cur)}/s`,
      cost: 'MAX',
      disabled: true,
    };
  }
  const cost = attendantSpeedCost(state, pump);
  const next = cur + U.gas.workerSpeed.ratePerLevel;
  return {
    kind: 'attendantSpeed',
    pitIndex: pump.index,
    label: 'Attendant Speed',
    effect: `${fmtRate(cur)} → ${fmtRate(next)}/s`,
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

/** Supermarket section: tuning only, once the market has been opened at its
 * floor marker — the worker's training level, its break room, and the truck.
 * (The unlock and the initial worker hire are physical markers; at workerLevel
 * 0 the only row is the truck.) */
function supermarketRows(state) {
  const S = state.supermarket;
  if (!S.unlocked) return []; // opened at its marker in the world, nothing to tune yet

  const rows = [];
  if (S.workerLevel === 1) {
    const cost = marketWorkerTrainCost(state);
    rows.push({
      kind: 'trainMarketWorker',
      label: 'Train Market Worker',
      effect: 'Worker also restocks, hands-free',
      cost: `$${formatMoney(cost)}`,
      disabled: state.cash < cost,
    });
  } else if (S.workerLevel >= 2) {
    rows.push({
      kind: 'trainMarketWorker',
      label: 'Market Worker',
      effect: 'Fully trained — packages and restocks',
      cost: 'MAX',
      disabled: true,
    });
  }
  // workerLevel 0: the worker is hired at its shop-floor marker — no row yet.

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

function workerBlock(state, pit) {
  const L = letter(pit.index);
  const rows = [];

  // The mechanic itself is hired at its pit-side marker; the block carries only
  // the tuning rows (Fixing Time works even before anyone is hired).
  if (pit.hasMechanic) rows.push(workerSpeedRow(state, pit));
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
