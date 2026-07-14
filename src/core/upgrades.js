import settings from '../config/settings.js';
import { formatMoney } from './format.js';
import { createMarketWorker, truckDeliveryTime } from './supermarket.js';
import { breakDurationAtLevel, breakThresholdAtLevel } from './breaks.js';
import { roomWallBox } from './collision.js';
import { rebuildGrid } from './pathfinding.js';

const U = settings.upgrades;

const geoCost = (cfg, level) => Math.round(cfg.baseCost * Math.pow(cfg.costGrowth, level));
const letter = (i) => String.fromCharCode(65 + i); // 0 -> "A"
const fmtRate = (r) => (Number.isInteger(r) ? `${r}` : r.toFixed(1));

export function workerSpeed(pit) {
  return U.workerSpeed.baseRate + pit.workerSpeedLevel * U.workerSpeed.ratePerLevel;
}

function factorAt(level) {
  return Math.max(U.fixingTime.factorFloor, 1 - level * U.fixingTime.factorPerLevel);
}

export function fixTimeFactor(pit) {
  return factorAt(pit.fixingTimeLevel);
}

export function requiredTicks(car, pit) {
  return car.baseTicks * fixTimeFactor(pit);
}

export function attendantSpeed(pump) {
  return U.gas.workerSpeed.baseRate + pump.workerSpeedLevel * U.gas.workerSpeed.ratePerLevel;
}

const LOT_HALF_WIDTH = 2.1; // half of PitView's lot/station plane width (4.2)
const BAY_MARGIN = 13.5; // gap from an owned lot's outer edge to the fence
export const BAY_ZONE_Z = -0.75; // z beyond this is bay territory (fenced); below it is the open lane

export function allLandOwned(state) {
  return state.pits.every((p) => p.roomUnlocked);
}

export function ownedRightX(state) {
  const unlockedCount = state.pits.filter((p) => p.roomUnlocked).length;
  const lastIndex = Math.max(0, unlockedCount - 1);
  const raw = settings.pit.positions[lastIndex].x + LOT_HALF_WIDTH + BAY_MARGIN;
  return Math.min(raw, settings.world.halfX);
}

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

function workerSpeedCost(state, pit) {
  return geoCost(U.workerSpeed, pit.workerSpeedLevel);
}

function fixingTimeCost(state, pit) {
  return geoCost(U.fixingTime, pit.fixingTimeLevel);
}

export function gasExpandCost(state) {
  const opened = state.gasStation.pumps.filter((p) => p.roomUnlocked).length;
  return geoCost(U.gas.expand, opened);
}

export function gasEquipmentCost(state, pumpIndex) {
  return geoCost(U.gas.equipment, pumpIndex);
}

function attendantHireCost(state, pumpIndex) {
  return geoCost(U.gas.attendant, pumpIndex);
}

function attendantSpeedCost(state, pump) {
  return geoCost(U.gas.workerSpeed, pump.workerSpeedLevel);
}

function breakLevel(state, kind) {
  return state.breakLevels[kind];
}

export function breakDurationCost(state, kind) {
  return geoCost(U.breakDuration[kind], breakLevel(state, kind));
}

export function breakThresholdCost(state, kind) {
  return geoCost(U.breakThreshold[kind], state.breakThresholdLevels[kind]);
}

export function playerSpeedMultiplier(state) {
  return state.playerSpeedBought ? U.playerSpeed.multiplier : 1;
}

export function playerSpeedCost(state) {
  return U.playerSpeed.baseCost;
}

export function cashierCost(state) {
  return U.cashier.baseCost;
}

export function autoRestockCost(state) {
  return settings.storage.autoRestockBaseCost;
}

export function supermarketCost(state) {
  return settings.supermarket.unlockBaseCost;
}

export function marketWorkerHireCost(state) {
  return settings.supermarket.workerHireCost;
}

export function marketWorkerTrainCost(state) {
  return settings.supermarket.workerTrainCost;
}

const TRUCK_MAX_LEVEL = settings.supermarket.truck.deliveryTimes.length - 1;

export function truckFrequencyCost(state) {
  return geoCost(U.truckFrequency, state.supermarket.truckUpgradeLevel);
}

export function pitReputationMet(state, pitIndex) {
  const need = settings.pit.unlockReputation[pitIndex] ?? 0;
  return state.permanentReputation >= need - 1e-9; // epsilon: rep accrues in float steps
}

export function buyExpandRoom(state) {
  const next = state.pits.find((p) => !p.roomUnlocked);
  if (!next) return false;
  if (!pitReputationMet(state, next.index)) return false;
  const cost = expandRoomCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  next.roomUnlocked = true;
  rebuildGrid([roomWallBox(ownedRightX(state))]);
  return true;
}

export function buyPitEquipment(state, pitIndex) {
  const pit = state.pits[pitIndex];
  if (!pit || !pit.roomUnlocked || pit.equipped) return false;
  const cost = pitEquipmentCost(state, pitIndex);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pit.equipped = true;
  return true;
}

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
  if (!pit || !pit.hasMechanic || pit.workerSpeedLevel >= U.workerSpeed.maxLevel) return false;
  const cost = workerSpeedCost(state, pit);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pit.workerSpeedLevel += 1;
  return true;
}

export function buyFixingTime(state, pitIndex) {
  const pit = state.pits[pitIndex];
  if (!pit || !pit.hasMechanic || pit.fixingTimeLevel >= U.fixingTime.maxLevel) return false;
  const cost = fixingTimeCost(state, pit);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pit.fixingTimeLevel += 1;
  return true;
}

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

export function buyGasEquipment(state, pumpIndex) {
  const pump = state.gasStation.pumps[pumpIndex];
  if (!pump || !pump.roomUnlocked || pump.equipped) return false;
  const cost = gasEquipmentCost(state, pumpIndex);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pump.equipped = true;
  const p = settings.gasStation.positions[pumpIndex];
  const player = state.player.position;
  const clear = settings.pitLane.halfWidth + settings.player.radius;
  if (Math.abs(player.x - p.x) < clear) player.x = p.x + clear + 0.05;
  return true;
}

export function hireAttendant(state, pumpIndex) {
  const pump = state.gasStation.pumps[pumpIndex];
  if (!pump || !pump.equipped || pump.hasAttendant) return false;
  const cost = attendantHireCost(state, pumpIndex);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pump.hasAttendant = true;
  return true;
}

export function buyAttendantSpeed(state, pumpIndex) {
  const pump = state.gasStation.pumps[pumpIndex];
  if (!pump || !pump.hasAttendant || pump.workerSpeedLevel >= U.gas.workerSpeed.maxLevel) return false;
  const cost = attendantSpeedCost(state, pump);
  if (state.cash < cost) return false;
  state.cash -= cost;
  pump.workerSpeedLevel += 1;
  return true;
}

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

function cashierMissing(state) {
  return !state.hasCashier;
}

export function buyAutoRestock(state) {
  if (state.autoRestock || cashierMissing(state)) return false;
  const cost = autoRestockCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.autoRestock = true;
  return true;
}

export function buySupermarket(state) {
  if (state.supermarket.unlocked) return false;
  const cost = supermarketCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.supermarket.unlocked = true;
  return true;
}

export function hireMarketWorker(state) {
  if (!state.supermarket.unlocked || state.supermarket.workerLevel !== 0 || cashierMissing(state)) return false;
  const cost = marketWorkerHireCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.supermarket.workerLevel = 1;
  state.supermarket.worker = createMarketWorker();
  return true;
}

export function trainMarketWorker(state) {
  if (state.supermarket.workerLevel !== 1 || cashierMissing(state)) return false;
  const cost = marketWorkerTrainCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.supermarket.workerLevel = 2;
  return true;
}

export function buyBreakDuration(state, kind) {
  const cfg = U.breakDuration[kind];
  if (!cfg || breakLevel(state, kind) >= U.breakDuration.maxLevel) return false;
  const cost = breakDurationCost(state, kind);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.breakLevels[kind] += 1;
  return true;
}

export function buyBreakThreshold(state, kind) {
  const cfg = U.breakThreshold[kind];
  if (!cfg || state.breakThresholdLevels[kind] >= U.breakThreshold.maxLevel) return false;
  const cost = breakThresholdCost(state, kind);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.breakThresholdLevels[kind] += 1;
  return true;
}

export function buyPlayerSpeed(state) {
  if (state.playerSpeedBought) return false;
  const cost = playerSpeedCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.playerSpeedBought = true;
  return true;
}

export function buyTruckFrequency(state) {
  const S = state.supermarket;
  if (!S.unlocked || S.truckUpgradeLevel >= TRUCK_MAX_LEVEL || cashierMissing(state)) return false;
  const cost = truckFrequencyCost(state);
  if (state.cash < cost) return false;
  state.cash -= cost;
  S.truckUpgradeLevel += 1;
  return true;
}

export function getUnlockMarkers(state) {
  const M = settings.unlockMarkers;
  const markers = [];

  const nextPit = state.pits.find((p) => !p.roomUnlocked);
  if (nextPit) {
    const p = settings.pit.positions[nextPit.index];
    const locked = !pitReputationMet(state, nextPit.index);
    markers.push({
      kind: 'expandRoom',
      index: nextPit.index,
      x: p.x + M.expandOffset.x,
      z: p.z + M.expandOffset.z,
      cost: expandRoomCost(state),
      locked,
      category: `Buy Lot ${letter(nextPit.index)}`,
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
        category: 'Garage Upgrade',
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
        category: 'Hire Worker',
        hint: `Hire worker ${letter(pit.index)}`,
      });
    }
  }

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
        category: 'Gas Station Unlock',
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
        category: 'Gas Station Upgrade',
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
        category: 'Gas Station Upgrade',
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
        category: 'Hire Attendant',
        hint: `Hire attendant ${pump.index + 1}`,
      });
    }
  }

  const S = state.supermarket;
  const spot = settings.supermarket.workerIdleSpot;
  if (!S.unlocked) {
    markers.push({
      kind: 'openMarket',
      x: spot.x,
      z: spot.z,
      cost: supermarketCost(state),
      locked: false,
      category: 'Supermarket Unlock',
      hint: 'Open the supermarket',
    });
  } else if (S.workerLevel === 0) {
    const locked = cashierMissing(state); // the hire is cashier-gated, like every other market upgrade
    const hireSpot = settings.supermarket.hireWorkerMarkerSpot;
    markers.push({
      kind: 'hireMarketWorker',
      x: hireSpot.x,
      z: hireSpot.z,
      cost: marketWorkerHireCost(state),
      locked,
      category: 'Hire Market Worker',
      hint: locked ? 'Hire a cashier first' : 'Hire the market worker',
    });
  }
  if (!state.hasCashier) {
    const c = settings.supermarket.cashRegisterPosition;
    markers.push({
      kind: 'hireCashier',
      x: c.x,
      z: c.z,
      cost: cashierCost(state),
      locked: false,
      category: 'Hire Cashier',
      hint: 'Hire the cashier',
    });
  }

  return markers;
}

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

export const REF_BASE_TICKS = settings.repair.ticksPerPart * 3;

export function getMenuModel(state) {
  return {
    automation: [autoRestockRow(state)],
    garageBreaks: state.pits.some((p) => p.hasMechanic)
      ? [
          breakDurationRow(state, 'carMechanic', 'mechanicBreak', 'Shorter Breaks — Mechanics'),
          breakThresholdRow(state, 'carMechanic', 'mechanicShift', 'Longer Shifts — Mechanics'),
        ]
      : [],
    gasBreaks: state.gasStation.pumps.some((p) => p.hasAttendant)
      ? [
          breakDurationRow(state, 'gasAttendant', 'attendantBreak', 'Shorter Breaks — Attendants'),
          breakThresholdRow(state, 'gasAttendant', 'attendantShift', 'Longer Shifts — Attendants'),
        ]
      : [],
    supermarket: supermarketRows(state),
    player: [playerSpeedRow(state)],
    workers: state.pits
      .filter((p) => p.equipped)
      .map((p) => workerBlock(state, p))
      .filter((b) => b.rows.length > 0),
    attendants: state.gasStation.pumps
      .filter((p) => p.equipped)
      .map((p) => attendantBlock(state, p))
      .filter((b) => b.rows.length > 0),
  };
}

function playerSpeedRow(state) {
  const speed = settings.player.speed;
  const boosted = speed * U.playerSpeed.multiplier;
  if (state.playerSpeedBought) {
    return {
      kind: 'playerSpeed',
      label: 'Player Speed',
      effect: `Move speed ${fmtRate(boosted)} (×${U.playerSpeed.multiplier})`,
      cost: 'OWNED',
      disabled: true,
    };
  }
  const cost = playerSpeedCost(state);
  return {
    kind: 'playerSpeed',
    label: 'Player Speed',
    effect: `Move speed ${fmtRate(speed)} → ${fmtRate(boosted)} (×${U.playerSpeed.multiplier})`,
    cost: `$${formatMoney(cost)}`,
    disabled: state.cash < cost,
  };
}

function breakDurationRow(state, workerKind, rowKind, label) {
  const lvl = breakLevel(state, workerKind);
  const cur = Math.round(breakDurationAtLevel(lvl));
  if (lvl >= U.breakDuration.maxLevel) {
    return { kind: rowKind, label, effect: `Breaks last ${cur}s`, cost: 'MAX', disabled: true };
  }
  const next = Math.round(breakDurationAtLevel(lvl + 1));
  const cost = breakDurationCost(state, workerKind);
  return {
    kind: rowKind,
    label,
    effect: `Breaks ${cur}s → ${next}s`,
    cost: `$${formatMoney(cost)}`,
    disabled: state.cash < cost,
  };
}

function breakThresholdRow(state, workerKind, rowKind, label) {
  const lvl = state.breakThresholdLevels[workerKind];
  const cur = breakThresholdAtLevel(workerKind, lvl);
  if (lvl >= U.breakThreshold.maxLevel) {
    return { kind: rowKind, label, effect: `Break after ${cur} jobs`, cost: 'MAX', disabled: true };
  }
  const next = breakThresholdAtLevel(workerKind, lvl + 1);
  const cost = breakThresholdCost(state, workerKind);
  return {
    kind: rowKind,
    label,
    effect: `Break after ${cur} → ${next} jobs`,
    cost: `$${formatMoney(cost)}`,
    disabled: state.cash < cost,
  };
}

function attendantBlock(state, pump) {
  const rows = [];
  if (pump.hasAttendant) {
    rows.push(attendantSpeedRow(state, pump));
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

function cashierLockedRow(kind, label, pitIndex) {
  return { kind, pitIndex, label, effect: 'Hire a cashier first', cost: 'LOCKED', disabled: true };
}

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
  if (cashierMissing(state)) return cashierLockedRow('autoRestock', 'Mechanic Auto-Restock');
  const cost = autoRestockCost(state);
  return {
    kind: 'autoRestock',
    label: 'Mechanic Auto-Restock',
    effect: 'Mechanics fetch boxes & restock, hands-free',
    cost: `$${formatMoney(cost)}`,
    disabled: state.cash < cost,
  };
}

function supermarketRows(state) {
  const S = state.supermarket;
  if (!S.unlocked) return []; // opened at its marker in the world, nothing to tune yet

  const rows = [];
  if (S.workerLevel === 1) {
    if (cashierMissing(state)) {
      rows.push(cashierLockedRow('trainMarketWorker', 'Train Market Worker'));
    } else {
      const cost = marketWorkerTrainCost(state);
      rows.push({
        kind: 'trainMarketWorker',
        label: 'Train Market Worker',
        effect: 'Worker also restocks, hands-free',
        cost: `$${formatMoney(cost)}`,
        disabled: state.cash < cost,
      });
    }
  } else if (S.workerLevel >= 2) {
    rows.push({
      kind: 'trainMarketWorker',
      label: 'Market Worker',
      effect: 'Fully trained — packages and restocks',
      cost: 'MAX',
      disabled: true,
    });
  }

  if (S.workerLevel >= 1) {
    rows.push(breakDurationRow(state, 'marketWorker', 'marketBreak', 'Shorter Breaks — Market Worker'));
    rows.push(breakThresholdRow(state, 'marketWorker', 'marketShift', 'Longer Shifts — Market Worker'));
  }

  rows.push(orderTruckRow(state));
  rows.push(truckFrequencyRow(state));

  return rows;
}

function orderTruckRow(state) {
  const S = state.supermarket;
  const box = S.restockBox;
  const label = 'Order Truck';
  const stock = `Box ${box.units}/${box.maxUnits}`;
  if (S.truckArriving) {
    return { kind: 'orderTruck', label, effect: `${stock} — truck arriving…`, cost: 'EN ROUTE', disabled: true };
  }
  if (S.truckOrdered) {
    const remaining = Math.max(0, Math.ceil(truckDeliveryTime(state) - S.truckTimer));
    return { kind: 'orderTruck', label, effect: `${stock} — arriving in ${remaining}s`, cost: 'ORDERED', disabled: true };
  }
  if (box.units >= box.maxUnits) {
    return { kind: 'orderTruck', label, effect: `${stock} — stock is full`, cost: 'FULL', disabled: true };
  }
  const effect =
    S.truckUpgradeLevel >= TRUCK_MAX_LEVEL
      ? `${stock} — auto-orders when empty`
      : `${stock} — delivery takes ${truckDeliveryTime(state)}s`;
  return { kind: 'orderTruck', label, effect, cost: 'ORDER', disabled: false };
}

const ROMAN = ['I', 'II', 'III'];
function truckFrequencyRow(state) {
  const times = settings.supermarket.truck.deliveryTimes;
  const lvl = state.supermarket.truckUpgradeLevel;
  const cur = times[Math.min(lvl, TRUCK_MAX_LEVEL)];
  if (lvl < TRUCK_MAX_LEVEL && cashierMissing(state)) {
    return cashierLockedRow('truckFrequency', 'Faster Deliveries');
  }
  if (lvl >= TRUCK_MAX_LEVEL) {
    return {
      kind: 'truckFrequency',
      label: 'Faster Deliveries',
      effect: `Delivery ${cur}s + auto-order when empty`,
      cost: 'MAX',
      disabled: true,
    };
  }
  const cost = truckFrequencyCost(state);
  const autoNote = lvl + 1 >= TRUCK_MAX_LEVEL ? ' + auto-order' : '';
  return {
    kind: 'truckFrequency',
    label: 'Faster Deliveries',
    effect: `${ROMAN[lvl]}: delivery ${cur}s → ${times[lvl + 1]}s${autoNote}`,
    cost: `$${formatMoney(cost)}`,
    disabled: state.cash < cost,
  };
}

function workerBlock(state, pit) {
  const L = letter(pit.index);
  const rows = [];

  if (pit.hasMechanic) {
    rows.push(workerSpeedRow(state, pit));
    rows.push(fixingTimeRow(state, pit));
  }

  return { index: pit.index, title: `Worker ${L}`, rows };
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
