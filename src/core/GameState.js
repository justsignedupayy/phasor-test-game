import settings from '../config/settings.js';
import { createBreakState } from './breaks.js';
import { createTutorialState } from './tutorial.js';
import { createHintsState } from './hints.js';

function createPit(index) {
  return {
    index,
    roomUnlocked: index === 0, // pit 0 starts open...
    equipped: index === 0, // ...and equipped; the rest start both false
    car: null,
    queue: [], // cars waiting for THIS pit (capped at settings.spawn.maxQueuePerPit)
    hasMechanic: false,
    workerSpeedLevel: 0,
    fixingTimeLevel: 0,
    playerPresent: false,
    hurryTimer: 0, // seconds of remaining worker speed boost (per pit)
    pendingCash: 0, // pay from finished cars waiting here for the player to collect
    collectedThisTick: 0, // one-tick render signal: $ banked this tick (scene pops "+$")
    tiresRemaining: settings.storage.maxTiresPerPit, // starts with one box worth
    shelfBoxes: settings.storage.shelfCapacity, // starts full
    playerNearShelf: false, // written by the scene each frame (proximity to this pit's shelf)
    mechanic: null,
    break: createBreakState(
      'carMechanic',
      index === 0 ? settings.breakThresholds.pitAFirstBreak : null,
      index === 0 ? settings.breakDurations.pitAFirstBreak : null
    ),
  };
}

function createPump(index) {
  return {
    index,
    roomUnlocked: false, // no free starter pump — the first Expand Station opens lot 0
    equipped: false,
    car: null,
    queue: [], // cars waiting for THIS pump (capped at settings.gasStation.spawn.maxQueuePerPump)
    hasAttendant: false,
    workerSpeedLevel: 0,
    playerPresent: false, // written by the scene each frame (proximity), core only reads
    hurryTimer: 0,
    pendingCash: 0, // pay from filled cars waiting here for the player to collect
    collectedThisTick: 0, // one-tick render signal, mirrors pit.collectedThisTick
    attendant: null,
    break: createBreakState('gasAttendant'),
  };
}

function createGasStationState() {
  return {
    pumps: Array.from({ length: settings.maxPumps }, (_, i) => createPump(i)),
    spawnTimer: settings.gasStation.spawn.interval, // seeded so the first car arrives immediately
  };
}

function createSupermarketState() {
  return {
    unlocked: false,
    workerLevel: 0,
    shelves: settings.supermarket.shelves.map((cfg, i) => ({
      index: i,
      productType: cfg.productType,
      stock: settings.supermarket.shelfCapacity,
    })),
    customerQueue: [],
    nextCustomerId: 1,
    spawnTimer: settings.supermarket.customerSpawnInterval, // seeded so the first customer arrives promptly
    assemblingBag: null, // { customerId, items:{A:n,...} } while being gathered (player or worker)
    checkoutBag: null, // { customerId, items, total } once fully assembled and placed at the counter
    worker: null, // { position:{x,z}, rotation, moving, carrying, state:'idle'|'packaging'|'restocking', ... } once workerLevel >= 1
    restockBoxPosition: { ...settings.supermarket.restockBoxPosition },
    restockBox: {
      units: settings.supermarket.restockBox.maxUnits,
      maxUnits: settings.supermarket.restockBox.maxUnits,
    },
    truckOrdered: false, // a delivery is ordered (manually, auto at max level, or via ad) and counting down
    truckTimer: 0, // counts up WHILE ordered; at >= truckDeliveryTime() the truck is dispatched
    truckUpgradeLevel: 0, // "Faster Deliveries" level (0..3); indexes settings.supermarket.truck.deliveryTimes
    truckArriving: false, // true while the truck's drive-in animation is in flight (scene drives this back to false via deliverStock)
    paidThisTick: 0, // one-tick render signal (the scene pops "+$" at checkout when this is > 0), mirrors pit.collectedThisTick
    lastCustomerTint: null, // the most recently spawned customer's tint, so spawnCustomer never repeats it back-to-back
  };
}

export class GameState {
  constructor() {
    this.cash = 0;

    this.hasCashier = false;

    this.autoRestock = false;

    this.breakLevels = { carMechanic: 0, marketWorker: 0, gasAttendant: 0 };

    this.breakThresholdLevels = { carMechanic: 0, marketWorker: 0, gasAttendant: 0 };

    this.playerSpeedBought = false;

    this.permanentReputation = settings.reputation.baseReputation;
    this.adCooldownRemaining = 0;
    this.adLevel = 0; // Buy Advertising purchase count (drives its geometric cost)

    this.pits = Array.from({ length: settings.maxPits }, (_, i) => createPit(i));

    this.spawnTimer = settings.spawn.interval;

    this.player = {
      position: { x: -24.5, z: 0 },
      rotation: 0, // radians around Y; 0 faces +z
      moving: false,
      carryingBox: false, // is the player holding a box right now?
      carryingBoxPitIndex: null, // which pit's shelf the carried box came from
      carryingRestockBox: false, // manual market restocking: carrying a box from the restock dock
    };

    this.input = { x: 0, z: 0 };

    this.supermarket = createSupermarketState();

    this.gasStation = createGasStationState();

    this.tutorial = createTutorialState();

    this.hints = createHintsState();
  }
}

export function createInitialState() {
  return new GameState();
}
