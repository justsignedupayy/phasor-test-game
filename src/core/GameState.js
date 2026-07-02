/**
 * GameState.js — the root game state. Pure data, no Three.js.
 * All mutation goes through the simulation / upgrades modules.
 */
import settings from '../config/settings.js';
import { createBreakState } from './breaks.js';

/**
 * One repair pit. Two-stage unlock: roomUnlocked (empty floor) then equipped
 * (accepts cars + allows hiring). `car` is null between cars; `playerPresent` is
 * written by the scene each frame (proximity) and only read by core. Derived
 * workerSpeed / fixTimeFactor live in upgrades.js (computed from the levels).
 *
 * `pendingCash` is pay from finished cars waiting at this pit to be collected:
 * without a cashier it sits here until the player walks up (playerPresent), then
 * tick() banks it into state.cash. With a cashier hired, payouts skip this and
 * land in state.cash directly, so pendingCash stays 0. It is part of the save.
 */
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
    // Tire stock: each completed repair burns one tire; at 0 the pit stops
    // taking cars until refilled. The shelf holds boxes the player (or, with
    // auto-restock, the mechanic) carries to the worker — one box = one full stack.
    tiresRemaining: settings.storage.maxTiresPerPit, // starts with one box worth
    shelfBoxes: settings.storage.shelfCapacity, // starts full
    playerNearShelf: false, // written by the scene each frame (proximity to this pit's shelf)
    // This pit's mechanic once hired: a core-owned NPC (position + restock/break FSM),
    // mirroring state.supermarket.worker. Created lazily by simulation.js on the first
    // tick after hire; the scene (Mechanic.js) renders it. null until hired.
    mechanic: null,
    // This pit mechanic's break clock (see core/breaks.js): a finished repair
    // counts a job; after enough the worker sits at its chair for a while.
    break: createBreakState('carMechanic'),
  };
}

/**
 * One gas pump — the gas station's mirror of createPit, same two-stage unlock
 * (roomUnlocked then equipped) and the same car/queue/hurry/pendingCash shape,
 * minus the pit-only tire/shelf systems. UNLIKE pit 0, EVERY pump starts locked:
 * the whole station only comes into existence with the first Expand Station
 * purchase (see upgrades.buyGasExpand). `attendant` is the pump's hired NPC
 * (core-owned position, mirrors pit.mechanic), created lazily by
 * core/gasStation.js on the first tick after hire.
 */
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
    // This attendant's break clock (see core/breaks.js): a filled car counts a
    // job; after enough the attendant sits at its chair beside the pump — the
    // exact mirror of a pit mechanic's pit.break.
    break: createBreakState('gasAttendant'),
  };
}

/** The gas station: parallel pumps + their own spawn clock (see core/gasStation.js). */
function createGasStationState() {
  return {
    pumps: Array.from({ length: settings.maxPumps }, (_, i) => createPump(i)),
    spawnTimer: settings.gasStation.spawn.interval, // seeded so the first car arrives immediately
  };
}

/**
 * The supermarket. unlocked is the one-time "Open Supermarket" purchase;
 * workerLevel is the 2-stage worker upgrade (0 = player does everything by
 * hand, 1 = worker packages, 2 = worker also restocks — see upgrades.js and
 * core/supermarket.js). shelves/customerQueue/checkoutBag/worker are all
 * advanced by tickSupermarket(); restockBoxPosition is copied from settings
 * once so a save is self-contained even if the layout setting later moves.
 */
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
    // The restock box's shared inventory (one unit = one full shelf refill). A
    // delivery truck tops it back up to maxUnits on a timer; at 0 nobody can
    // restock until the next truck (see core/supermarket.js: takeRestockUnit /
    // tickTruck / deliverStock / callTruckEarly). Starts full.
    restockBox: {
      units: settings.supermarket.restockBox.maxUnits,
      maxUnits: settings.supermarket.restockBox.maxUnits,
    },
    truckTimer: 0, // counts up; at >= truckDeliveryInterval() the next truck is dispatched
    truckUpgradeLevel: 0, // "Faster Deliveries" level (0..3); indexes settings.supermarket.truck.intervals
    truckArriving: false, // true while the truck's drive-in animation is in flight (scene drives this back to false via deliverStock)
    paidThisTick: 0, // one-tick render signal (the scene pops "+$" at checkout when this is > 0), mirrors pit.collectedThisTick
    lastCustomerTint: null, // the most recently spawned customer's tint, so spawnCustomer never repeats it back-to-back
  };
}

export class GameState {
  constructor() {
    this.cash = 0;

    // Cashier: a single garage-wide, one-time hire (see upgrades.js buyCashier).
    // Without it, finished cars park their pay at their pit (pit.pendingCash)
    // until the player walks up to collect; once hired, every payout lands in
    // state.cash directly and no money ever waits at a pit.
    this.hasCashier = false;

    // Auto-restock: a one-time, garage-wide upgrade (see upgrades.js buyAutoRestock).
    // While owned, each pit's hired mechanic fetches a box from its own shelf and
    // refills its tire stack itself when it runs dry — the player no longer has to
    // hand-carry boxes (see simulation.updateMechanic). Replaces the old conveyor.
    this.autoRestock = false;

    // Reputation: chance an incoming car is a higher-paying "better" car (see
    // core/reputation.js). permanentReputation rises via Buy Advertising;
    // repBoostRemaining counts down a temporary rewarded-ad multiplier.
    this.permanentReputation = settings.reputation.baseReputation;
    this.repBoostRemaining = 0;
    this.adLevel = 0; // Buy Advertising purchase count (drives its geometric cost)

    // Parallel pits, lowest index first. Each pit owns its own waiting queue.
    this.pits = Array.from({ length: settings.maxPits }, (_, i) => createPit(i));

    // Countdown to the next spawn (a spawned car is routed to the pit matching
    // its reputation tier — see simulation.spawnToMatchingPit — and discarded if
    // that pit can't take it). Seeded so the first car arrives immediately.
    this.spawnTimer = settings.spawn.interval;

    // Starts inside pit 0's own bay (the only owned land at game start; see
    // upgrades.js ownedRightX). Pit 0 sits at x = -27, so the player spawns there
    // (in front of it) rather than at the world origin or the left lobby.
    this.player = {
      position: { x: -27, z: 0 },
      rotation: 0, // radians around Y; 0 faces +z
      moving: false,
      carryingBox: false, // is the player holding a box right now?
      carryingBoxPitIndex: null, // which pit's shelf the carried box came from
      carryingRestockBox: false, // manual market restocking: carrying a box from the restock dock
    };

    // Desired move direction in WORLD space (x/z), magnitude 0..1.
    this.input = { x: 0, z: 0 };

    // The supermarket (see core/supermarket.js + upgrades.js).
    this.supermarket = createSupermarketState();

    // The gas station (see core/gasStation.js + upgrades.js).
    this.gasStation = createGasStationState();
  }
}

export function createInitialState() {
  return new GameState();
}
