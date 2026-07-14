import settings from '../config/settings.js';
import { formatMoney } from './format.js';
import {
  hireCost,
  expandRoomCost,
  cashierCost,
  supermarketCost,
  marketWorkerHireCost,
  pitReputationMet,
} from './upgrades.js';
import { frontCustomer } from './supermarket.js';

export const TUTORIAL_STEPS = [
  'repairCars', // complete settings.tutorial.repairCount manual repairs at pit A
  'restockPit', // carry a box from pit A's shelf back to pit A
  'hireMechanic', // (once affordable) hire pit A's worker at its ground marker
  'breakLed', // walk to pit A's wall LED (jobs-to-break / break countdown)
  'firstPendingCash', // pit A's worker banks its first pending cash → tap to hurry, walk up to collect
  'firstBreak', // the worker's special early first break → tap them (or let it end)
  'firstRestock', // pit A runs dry under the worker → hand-carry a box
  'viewWorkerUpgrade', // open the tablet's Garage tab (seeing the Worker Speed row is enough)
  'gainReputation', // perform ONE reputation gain (Watch Ad or Buy Advertising)
  'buyLotB', // (once affordable) buy lot B at its ground marker
  'hireCashier', // (once affordable) hire the cashier at the register marker
  'openMarket', // (once affordable) unlock the supermarket at its floor marker
  'serveCustomer', // manually fulfil one customer's order (shelves → checkout)
  'restockMarket', // carry a restock box from the dock to a market shelf
  'orderTruck', // place a delivery order (tablet Market tab / empty-box panel)
  'truckLed', // walk to the delivery corridor's LED (arrival countdown)
  'hireMarketWorker', // (once affordable) hire the market worker at its marker
  'finale', // one-time popup, no highlight; ends the tutorial
];

export function createTutorialState() {
  return {
    active: true, // false once the finale dismisses — the tutorial never returns
    step: 0, // index into TUTORIAL_STEPS
    shown: false, // gated steps stay hidden until this latches true
    repairsRemaining: settings.tutorial.repairCount, // step 'repairCars': COMPLETED manual repairs left
    repBaseline: null, // permanentReputation captured on entering 'gainReputation'
    finaleTimer: 0, // seconds the finale popup has been up (auto-dismisses)
    pendingCashArmed: false, // step 'firstPendingCash': true once shown has survived a full frame
    pendingCashEverEarned: false, // step 'firstPendingCash': latched the FIRST time any completed
    firstBreakEverStarted: false, // step 'firstBreak': latched the FIRST time pit 0's worker is
  };
}

export function currentTutorialStep(state) {
  const t = state.tutorial;
  if (!t || !t.active) return null;
  return TUTORIAL_STEPS[t.step] ?? null;
}

function stepVisible(state, id) {
  switch (id) {
    case 'hireMechanic':
      return state.cash >= hireCost(state, 0);
    case 'buyLotB':
      return state.cash >= expandRoomCost(state) && pitReputationMet(state, 1);
    case 'hireCashier':
      return state.cash >= cashierCost(state);
    case 'openMarket':
      return state.cash >= supermarketCost(state);
    case 'hireMarketWorker':
      return state.cash >= marketWorkerHireCost(state);
    case 'firstPendingCash':
      return state.tutorial.pendingCashEverEarned || state.pits[0].pendingCash > 0;
    case 'firstRestock':
      return state.pits[0].tiresRemaining <= 0; // waits for the pit to actually run dry
    case 'firstBreak':
      return state.tutorial.firstBreakEverStarted || state.pits[0].break.onBreak;
    default:
      return true;
  }
}

function advance(state) {
  const t = state.tutorial;
  t.step += 1;
  t.shown = false;
  if (t.step >= TUTORIAL_STEPS.length) {
    t.active = false;
    return;
  }
  if (TUTORIAL_STEPS[t.step] === 'gainReputation') {
    t.repBaseline = state.permanentReputation;
  }
}

function playerNear(state, p) {
  const pos = state.player.position;
  return Math.hypot(pos.x - p.x, pos.z - p.z) <= settings.tutorial.ledProximity;
}

function pitWorkerSpot(pitIndex) {
  const p = settings.pit.positions[pitIndex];
  const M = settings.mechanic;
  return { x: p.x + M.offsetX, z: p.z + M.offsetZ };
}

function truckLedSpot() {
  const W = settings.world;
  const M = settings.supermarket;
  const corridorStart = -(W.halfZ + W.wallThickness); // the building wall's outer face
  return { x: M.deliveryDoorX - W.gateHalf, z: (corridorStart + M.deliveryDoorZ) / 2 };
}

export function tickTutorial(state, dt) {
  const t = state.tutorial;
  if (!t || !t.active) return;

  if (state.pits[0].break.onBreak) t.firstBreakEverStarted = true;

  const id = TUTORIAL_STEPS[t.step];
  if (!t.shown && stepVisible(state, id)) t.shown = true;

  switch (id) {
    case 'repairCars':
      if (t.repairsRemaining <= 0) advance(state);
      break;
    case 'hireMechanic':
      if (state.pits[0].hasMechanic) advance(state);
      break;
    case 'breakLed':
      if (playerNear(state, settings.breaks.breakSpots[0])) advance(state);
      break;
    case 'firstPendingCash':
      if (t.shown && t.pendingCashArmed && state.pits[0].pendingCash <= 0) advance(state);
      t.pendingCashArmed = t.shown;
      break;
    case 'firstBreak':
      if (t.shown && !state.pits[0].break.onBreak) advance(state);
      break;
    case 'gainReputation':
      if (t.repBaseline === null) t.repBaseline = state.permanentReputation;
      if (
        state.permanentReputation > t.repBaseline + 1e-9 ||
        state.permanentReputation >= settings.reputation.repCap - 1e-9
      ) {
        advance(state);
      }
      break;
    case 'buyLotB':
      if (state.pits[1].roomUnlocked) advance(state);
      break;
    case 'hireCashier':
      if (state.hasCashier) advance(state);
      break;
    case 'openMarket':
      if (state.supermarket.unlocked) advance(state);
      break;
    case 'serveCustomer':
      if (state.supermarket.paidThisTick > 0) advance(state);
      break;
    case 'orderTruck':
      if (state.supermarket.truckOrdered || state.supermarket.truckArriving) advance(state);
      break;
    case 'truckLed':
      if (
        playerNear(state, truckLedSpot()) ||
        (!state.supermarket.truckOrdered && !state.supermarket.truckArriving)
      ) {
        advance(state);
      }
      break;
    case 'hireMarketWorker':
      if (state.supermarket.workerLevel >= 1) advance(state);
      break;
    case 'finale':
      t.finaleTimer += dt;
      if (t.finaleTimer >= settings.tutorial.finalePopupSeconds) advance(state); // past the last step → done
      break;
  }
}

export function onManualRepairCompleted(state, pitIndex) {
  const t = state.tutorial;
  if (!t || !t.active || TUTORIAL_STEPS[t.step] !== 'repairCars' || pitIndex !== 0) return;
  t.repairsRemaining = Math.max(0, t.repairsRemaining - 1);
  if (t.repairsRemaining <= 0) advance(state);
}

export function onPitCashAccrued(state, pitIndex) {
  const t = state.tutorial;
  if (!t || pitIndex !== 0) return;
  t.pendingCashEverEarned = true;
  if (currentTutorialStep(state) === 'firstPendingCash') t.shown = true;
}

export function onPitHurried(state, pitIndex) {
  const t = state.tutorial;
  if (!t || currentTutorialStep(state) !== 'firstPendingCash' || pitIndex !== 0) return;
  if (t.shown) advance(state);
}

export function onPitShelfRestocked(state, pitIndex) {
  const id = currentTutorialStep(state);
  if ((id === 'restockPit' || id === 'firstRestock') && pitIndex === 0) advance(state);
}

export function notifyBreakMenuOpened(state, pitIndex) {
  if (currentTutorialStep(state) === 'firstBreak' && pitIndex === 0) advance(state);
}

export function notifyGarageTabViewed(state) {
  if (currentTutorialStep(state) === 'viewWorkerUpgrade') advance(state);
}

export function notifyMarketShelfRestocked(state) {
  if (currentTutorialStep(state) === 'restockMarket') advance(state);
}

export function dismissTutorialFinale(state) {
  if (currentTutorialStep(state) === 'finale') advance(state);
}

const world = (pos, y) => ({ kind: 'world', x: pos.x, z: pos.z, ...(y !== undefined ? { y } : {}) });
const tablet = (tab, element) => ({ kind: 'tablet', tab, element });

export function getTutorialView(state, getPaid = () => 0) {
  const t = state.tutorial;
  if (!t || !t.active) return null;

  const id = TUTORIAL_STEPS[t.step];
  if (!t.shown && !stepVisible(state, id)) return pendingView(state, id, getPaid);

  const P = settings.pit.positions;
  const U = settings.unlockMarkers;
  const M = settings.supermarket;
  const ledBubbleY = settings.breaks.display.y + 0.7; // bubble floats just over the panel

  switch (id) {
    case 'repairCars':
      return {
        id,
        text: `Repair cars manually — tap the car! ${t.repairsRemaining} left`,
        anchor: world(P[0]),
      };

    case 'restockPit': {
      const carrying = state.player.carryingBox && state.player.carryingBoxPitIndex === 0;
      const shelf = { x: P[0].x + settings.storage.shelfOffset.x, z: P[0].z + settings.storage.shelfOffset.z };
      return carrying
        ? { id, text: 'Carry the box back to pit A to restock its tires', anchor: world(P[0]) }
        : { id, text: "Walk to pit A's shelf to pick up a box", anchor: world(shelf) };
    }

    case 'hireMechanic':
      return {
        id,
        text: 'Stand in the circle to hire a worker for pit A',
        anchor: world({ x: P[0].x + U.hireOffset.x, z: P[0].z + U.hireOffset.z }),
      };

    case 'breakLed':
      return {
        id,
        text: "This LED counts your worker's jobs left until their break — and the countdown until they resume while resting. Walk over for a look",
        anchor: world(settings.breaks.breakSpots[0], ledBubbleY),
      };

    case 'firstPendingCash':
      return {
        id,
        text: 'Your worker earned cash on that repair! Tap them to shout hurry and speed them up, or walk up to collect the pending cash directly',
        anchor: world(pitWorkerSpot(0)),
      };

    case 'firstRestock':
      return pitRestockView(state, id, 'Pit A is out of tires!');

    case 'firstBreak':
      return {
        id,
        text: 'Your worker is taking a break! Tap them to watch an ad and wake them early — the LED above tracks their rest',
        anchor: world(settings.breaks.breakSpots[0]),
      };

    case 'viewWorkerUpgrade':
      return {
        id,
        text: "Open the tablet's Garage tab — you can boost your worker's speed there",
        anchor: tablet('garage', 'workerSpeed:0'),
      };

    case 'gainReputation':
      return {
        id,
        text: 'Gain reputation: watch an ad or buy advertising in the Advertising tab',
        anchor: tablet('ads', 'watchAd'),
      };

    case 'buyLotB':
      return {
        id,
        text: 'Stand in the circle to buy lot B',
        anchor: world({ x: P[1].x + U.expandOffset.x, z: P[1].z + U.expandOffset.z }),
      };

    case 'hireCashier':
      return {
        id,
        text: 'Hire the cashier — your pay then gets collected automatically',
        anchor: world(M.cashRegisterPosition),
      };

    case 'openMarket':
      return { id, text: 'Stand in the circle to open the supermarket', anchor: world(M.workerIdleSpot) };

    case 'serveCustomer':
      return serveCustomerView(state, id);

    case 'restockMarket': {
      if (state.player.carryingRestockBox) {
        const idx = emptiestShelfBelowCapacity(state);
        const shelf = M.shelves[idx ?? 0];
        return { id, text: 'Carry the box to the highlighted shelf to restock it', anchor: world(shelf) };
      }
      return { id, text: 'Pick up a restock box from the delivery dock outside', anchor: world(M.restockBoxPosition) };
    }

    case 'orderTruck':
      return {
        id,
        text: "Call the delivery truck: open the tablet's Market tab and tap ORDER",
        anchor: tablet('market', 'orderTruck'),
      };

    case 'truckLed':
      return {
        id,
        text: "Delivery ordered! You can track the truck's arrival countdown on this LED display",
        anchor: world(truckLedSpot(), ledBubbleY),
      };

    case 'hireMarketWorker':
      return {
        id,
        text: 'Hire the market worker — they package orders for you',
        anchor: world(M.hireWorkerMarkerSpot),
      };

    case 'finale':
      return {
        id,
        text: 'Great work! Fully upgrade the garage and supermarket, then unlock the Gas Station!',
        anchor: { kind: 'popup' },
      };

    default:
      return null;
  }
}

function pendingView(state, id, getPaid) {
  const info = (text) => ({ id, pending: true, text, anchor: { kind: 'info' } });
  const remaining = (cost, kind, index) => formatMoney(Math.max(0, cost - getPaid(kind, index)));
  switch (id) {
    case 'hireMechanic':
      return info(`Costs $${remaining(hireCost(state, 0), 'hireMechanic', 0)} to hire your first worker`);
    case 'buyLotB':
      if (!pitReputationMet(state, 1)) return info('Raise your reputation to unlock lot B');
      return info(`Costs $${remaining(expandRoomCost(state), 'expandRoom', 1)} to buy lot B`);
    case 'hireCashier':
      return info(`Costs $${remaining(cashierCost(state), 'hireCashier')} to hire the cashier`);
    case 'openMarket':
      return info(`Costs $${remaining(supermarketCost(state), 'openMarket')} to open the supermarket`);
    case 'hireMarketWorker':
      return info(`Costs $${remaining(marketWorkerHireCost(state), 'hireMarketWorker')} to hire the market worker`);
    case 'firstBreak':
      if (state.pits[0].tiresRemaining <= 0) {
        return { ...pitRestockView(state, id, 'Keep your worker supplied —'), pending: true };
      }
      return null;
    default:
      return null;
  }
}

function pitRestockView(state, id, prefix) {
  const p = settings.pit.positions[0];
  const carrying = state.player.carryingBox && state.player.carryingBoxPitIndex === 0;
  if (carrying) {
    return { id, text: 'Carry the box to your worker to restock the tires', anchor: world(p) };
  }
  const shelf = { x: p.x + settings.storage.shelfOffset.x, z: p.z + settings.storage.shelfOffset.z };
  return { id, text: `${prefix} grab a box from the shelf`, anchor: world(shelf) };
}

function serveCustomerView(state, id) {
  const S = state.supermarket;
  const M = settings.supermarket;
  const checkout = world(M.checkoutPosition);

  const customer = frontCustomer(state);
  if (!customer) return { id, text: 'Wait for a customer to arrive…', anchor: checkout };
  if (S.checkoutBag) return { id, text: 'The customer is coming to pay…', anchor: checkout };

  const bag = S.assemblingBag && S.assemblingBag.customerId === customer.id ? S.assemblingBag : null;
  let emptyNeeded = null;
  for (let i = 0; i < S.shelves.length; i++) {
    const type = S.shelves[i].productType;
    const wanted = customer.request[type] || 0;
    const have = bag ? bag.items[type] || 0 : 0;
    if (wanted <= have) continue;
    if (S.shelves[i].stock > 0) {
      const label = M.products[type]?.label ?? type;
      return { id, text: `Tap the highlighted shelf to collect ${label} for the customer`, anchor: world(M.shelves[i]) };
    }
    emptyNeeded = i;
  }
  if (emptyNeeded !== null) {
    return { id, text: 'That shelf is out of stock — restock it to finish the order', anchor: world(M.shelves[emptyNeeded]) };
  }
  return { id, text: 'Order complete — tap the checkout to place the bag', anchor: checkout };
}

function emptiestShelfBelowCapacity(state) {
  const cap = settings.supermarket.shelfCapacity;
  let best = null;
  let bestStock = cap;
  for (const shelf of state.supermarket.shelves) {
    if (shelf.stock < bestStock) {
      best = shelf.index;
      bestStock = shelf.stock;
    }
  }
  return best;
}
