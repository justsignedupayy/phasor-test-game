/**
 * tutorial.js — the mandatory first-game tutorial's state machine. No Three.js.
 *
 * A linear list of steps (TUTORIAL_STEPS) walks a brand-new player through the
 * game's first unlocks: manual repairs → the pit shelf restock → the first
 * mechanic hire → the break LED / first pending cash / first dry pit / first
 * break → the tablet's upgrade rows → reputation → lot B → cashier → supermarket → serving/
 * restocking/truck (+ its LED) → the market worker hire → a one-time finale
 * popup. The game itself is NEVER gated — every step is pure guidance,
 * completed by watching live state (or an explicit notify* hook for the few
 * player-only actions core can't tell apart from a worker's).
 *
 *   tickTutorial(state, dt)   advance visibility latches + state-watched steps;
 *                             called once per frame from main.js AFTER the sims.
 *   getTutorialView(state, getPaid)  the render view model: { id, text, anchor }
 *                             or null while nothing should show. getPaid is an
 *                             optional (kind, index) => number callback (default
 *                             () => 0) reporting how much of an UnlockMarkers
 *                             drain-to-pay marker's cost is already paid down —
 *                             the "costs $X" banners subtract it so the price
 *                             they show falls live as a walk-up-to-pay drain
 *                             pays the marker down. Anchors are world
 *                             positions ({ kind:'world', x, z, y? } — y is the
 *                             instruction bubble's height), tablet targets
 *                             ({ kind:'tablet', tab, element }) the scene
 *                             resolves against the UpgradeMenu, an
 *                             informational banner ({ kind:'info' }, the
 *                             "costs $X" waiting hints — pending:true), or
 *                             the finale popup ({ kind:'popup' }).
 *   notify* / on* hooks       explicit completion signals for player-performed
 *                             actions (manual repair completion, pit/market
 *                             restock, viewing the Garage tab, opening the
 *                             break menu, dismissing the finale).
 *
 * state.tutorial is part of the save (see GameState.js + storage.js v18): the
 * tutorial runs once per fresh game and, once done, never shows again.
 */
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

/**
 * The steps, in order. state.tutorial.step indexes into this list.
 *
 * NOTE on the worker-lifecycle trio: firstBreak sits BEFORE firstRestock on
 * purpose. The break this step showcases is pit A's special EARLY first break
 * (settings.breakThresholds.pitAFirstBreak = 5 jobs, 30s — see
 * GameState.createPit), which arrives long before the pit's 25-tire stack can
 * run dry — so the step must already be current to catch it live; parked
 * behind firstRestock (which waits for the dry pit at ~25 jobs) it could only
 * ever fire on the SECOND, full-threshold break. A first break the player
 * still manages to miss (come and gone during an earlier step) is remembered
 * by t.firstBreakEverStarted and the step completes itself instead of waiting
 * ~50 more jobs for the next one; and if the pit somehow runs dry while
 * waiting, firstBreak carries its own out-of-tires guidance (see pendingView)
 * so no-tires → no-jobs → no-break can't deadlock it.
 */
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

/** Fresh tutorial state, embedded in GameState (persisted with the save). */
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
    // repair ever banks pit 0's pendingCash, regardless of the current step — persists even if
    // the cash gets auto-collected (player standing there) before this step is even reached, so
    // a pit that runs fully dry in the meantime (no more repairs possible, pendingCash back at 0)
    // can't erase the only evidence the step's visibility check would otherwise rely on.
    firstBreakEverStarted: false, // step 'firstBreak': latched the FIRST time pit 0's worker is
    // ever seen on break, regardless of the current step. Pit A's special early first break
    // (5 jobs, 30s — see GameState.createPit) can come and go while an earlier step is still
    // current; without this latch the step's visibility could only catch a break running LIVE,
    // silently waiting for the second (full-threshold) break instead of the first.
  };
}

/** The current step id, or null once the tutorial is over. */
export function currentTutorialStep(state) {
  const t = state.tutorial;
  if (!t || !t.active) return null;
  return TUTORIAL_STEPS[t.step] ?? null;
}

// --- step visibility ---------------------------------------------------------
//
// The "once affordable" steps don't show their highlight until the player can
// actually pay for the purchase they point at (they show an informational
// "earn $X more" banner instead — see pendingView); the worker-lifecycle steps
// wait for their triggering event. Visibility LATCHES (t.shown) so e.g. the
// marker drain dropping cash below the cost mid-unlock never flickers the
// highlight off.

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
      // pendingCashEverEarned is the real signal (see createTutorialState): a
      // pit that's ALREADY dry and already collected by the time this step is
      // reached would otherwise never show pendingCash > 0 again — no tires
      // left means no more repairs, ever, to re-trigger it. The live
      // pendingCash check is just a harmless fallback for the common case.
      return state.tutorial.pendingCashEverEarned || state.pits[0].pendingCash > 0;
    case 'firstRestock':
      return state.pits[0].tiresRemaining <= 0; // waits for the pit to actually run dry
    case 'firstBreak':
      // firstBreakEverStarted is the real signal (see createTutorialState): the
      // special early first break may already be over before this step is even
      // reached — a live onBreak check alone would skip it and sit waiting for
      // the SECOND break. The live check is the common in-the-moment case.
      return state.tutorial.firstBreakEverStarted || state.pits[0].break.onBreak;
    default:
      return true;
  }
}

/** Advance to the next step (or finish) + per-step entry bookkeeping. */
function advance(state) {
  const t = state.tutorial;
  t.step += 1;
  t.shown = false;
  if (t.step >= TUTORIAL_STEPS.length) {
    t.active = false;
    return;
  }
  if (TUTORIAL_STEPS[t.step] === 'gainReputation') {
    // The step demands ONE fresh gain, even if reputation already meets lot B's
    // threshold — baseline whatever the player walked in with.
    t.repBaseline = state.permanentReputation;
  }
}

/** Is the player within the tutorial's look-at range of a world point? */
function playerNear(state, p) {
  const pos = state.player.position;
  return Math.hypot(pos.x - p.x, pos.z - p.z) <= settings.tutorial.ledProximity;
}

/** A pit's work spot beside the car — mirrors simulation.js's `work` point
 * (hurry/updatePit), so the tutorial highlight sits on the worker itself. */
function pitWorkerSpot(pitIndex) {
  const p = settings.pit.positions[pitIndex];
  const M = settings.mechanic;
  return { x: p.x + M.offsetX, z: p.z + M.offsetZ };
}

/**
 * Where the delivery corridor's truck LED hangs (its ground point) — mirrors
 * SupermarketView.#buildTruckDisplay's placement math: the corridor's left
 * wall, halfway down it.
 */
function truckLedSpot() {
  const W = settings.world;
  const M = settings.supermarket;
  const corridorStart = -(W.halfZ + W.wallThickness); // the building wall's outer face
  return { x: M.deliveryDoorX - W.gateHalf, z: (corridorStart + M.deliveryDoorZ) / 2 };
}

// --- per-frame tick ------------------------------------------------------------

/**
 * Advance the tutorial against live state. Called once per frame (after
 * tick/tickSupermarket/tickGasStation, so one-tick signals like paidThisTick
 * are still readable). Steps completed by an explicit player action instead
 * advance inside their notify/on hook below.
 */
export function tickTutorial(state, dt) {
  const t = state.tutorial;
  if (!t || !t.active) return;

  // Pit A's worker's first break can start (and end, 30 seconds later) while an
  // earlier step is still current — latch that it ever happened, on every step,
  // so 'firstBreak' never has to catch it live (see stepVisible).
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
      // Completed by walking up for a look at the panel.
      if (playerNear(state, settings.breaks.breakSpots[0])) advance(state);
      break;
    case 'firstPendingCash':
      // Completed once the cash is actually banked (walking up collects it via
      // collectPending) — a hurry tap alone doesn't clear pendingCash. Arms one
      // frame after becoming visible: if the player is already standing at the
      // pit, collectPending can bank the cash in the SAME tick it's earned, and
      // without this guard the step would latch shown + immediately advance
      // before the message ever rendered a single frame.
      if (t.shown && t.pendingCashArmed && state.pits[0].pendingCash <= 0) advance(state);
      t.pendingCashArmed = t.shown;
      break;
    case 'firstBreak':
      // Tapping the resting worker advances via notifyBreakMenuOpened; a break
      // that simply ran its course (or was ad-ended) completes the step too —
      // there is no resting worker left to point at. The same line auto-skips
      // the step when the first break came and went entirely during an earlier
      // step (shown latches off firstBreakEverStarted with onBreak already
      // false) rather than waiting for the second break.
      if (t.shown && !state.pits[0].break.onBreak) advance(state);
      break;
    case 'gainReputation':
      if (t.repBaseline === null) t.repBaseline = state.permanentReputation;
      // Reputation only ever rises and both gain actions refuse once at repCap
      // (see reputation.js), so a player who already maxed it out BEFORE
      // reaching this step (the tutorial never gates gameplay — Buy Advertising
      // works from step 1 on) can never satisfy "a fresh gain" — without this
      // OR the step would deadlock forever, blocking buyLotB and everything
      // after it too.
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
      // paidThisTick is the checkout's one-tick render signal — at this point
      // no market worker exists (hired at a later step), so any checkout here
      // was the player's manual fulfilment.
      if (state.supermarket.paidThisTick > 0) advance(state);
      break;
    case 'orderTruck':
      if (state.supermarket.truckOrdered || state.supermarket.truckArriving) advance(state);
      break;
    case 'truckLed':
      // Completed by walking to the corridor panel — or, failing that, once the
      // ordered delivery has already landed (nothing left to count down).
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
    // 'restockPit', 'firstRestock', 'viewWorkerUpgrade', 'restockMarket'
    // advance via their hooks below.
  }
}

// --- explicit completion hooks --------------------------------------------------
//
// Player-only actions core can't distinguish from a worker's by watching state
// alone; each is called at the one call site where the PLAYER performed it.

/** A manual tap-driven repair COMPLETED a car (called from simulation.tapRepair
 * only on the tap that finished the car — mid-repair taps never count). */
export function onManualRepairCompleted(state, pitIndex) {
  const t = state.tutorial;
  if (!t || !t.active || TUTORIAL_STEPS[t.step] !== 'repairCars' || pitIndex !== 0) return;
  t.repairsRemaining = Math.max(0, t.repairsRemaining - 1);
  if (t.repairsRemaining <= 0) advance(state);
}

/** A completed repair just banked pending cash at pit 0 (called from
 * simulation.applyRepair the instant pit.pendingCash is incremented, for
 * EVERY such repair — not just the first, and regardless of the current
 * tutorial step). Two jobs, for two different races:
 *  (1) pendingCashEverEarned latches PERMANENTLY the first time this ever
 *      happens, independent of the current step. Without it, a pit that
 *      finishes earning + auto-collecting ALL its cash (and runs fully dry —
 *      no tires left for another repair, ever) before the player even
 *      reaches 'firstPendingCash' would leave stepVisible's live pendingCash
 *      check permanently false with nothing left to ever re-trigger this
 *      hook — a silent, permanent deadlock blocking every step after it.
 *  (2) shown latches immediately if we're ALREADY on 'firstPendingCash' —
 *      collectPending can bank that same cash later in the SAME tick if the
 *      player is already standing at the pit, and by the time tickTutorial
 *      runs afterward, a live pendingCash check would already see it back at
 *      0. Setting the latch here, before collectPending gets a chance to
 *      run, guarantees THIS particular tick isn't silently skipped either. */
export function onPitCashAccrued(state, pitIndex) {
  const t = state.tutorial;
  if (!t || pitIndex !== 0) return;
  t.pendingCashEverEarned = true;
  if (currentTutorialStep(state) === 'firstPendingCash') t.shown = true;
}

/** The player tapped a manned pit's car to remotely hurry the worker
 * (simulation.hurry, only when the boost actually applied). The step's own
 * text offers TWO valid actions — tap to hurry, or walk up to collect — but
 * only walking up ever cleared pendingCash to complete it; a player who taps
 * hurry (the obvious one-tap action, no walking required) and never returns
 * to the pit got stuck on this step forever, silently blocking every step
 * after it. Gated on `shown` so an idle hurry-tap from BEFORE this step ever
 * became visible (hurry works regardless of tutorial state) can't skip the
 * message before it renders. */
export function onPitHurried(state, pitIndex) {
  const t = state.tutorial;
  if (!t || currentTutorialStep(state) !== 'firstPendingCash' || pitIndex !== 0) return;
  if (t.shown) advance(state);
}

/** The player hand-delivered a box to a pit (simulation.updateStorage's delivery).
 * Completes BOTH carry steps: the intro restock and the first post-hire one. */
export function onPitShelfRestocked(state, pitIndex) {
  const id = currentTutorialStep(state);
  if ((id === 'restockPit' || id === 'firstRestock') && pitIndex === 0) advance(state);
}

/** The player tapped the resting worker (main.js opened the break panel). */
export function notifyBreakMenuOpened(state, pitIndex) {
  if (currentTutorialStep(state) === 'firstBreak' && pitIndex === 0) advance(state);
}

/** The tablet is open on the Garage tab (called per-frame from main.js). */
export function notifyGarageTabViewed(state) {
  if (currentTutorialStep(state) === 'viewWorkerUpgrade') advance(state);
}

/** The player restocked a market shelf by hand (main.js's shelf tap). */
export function notifyMarketShelfRestocked(state) {
  if (currentTutorialStep(state) === 'restockMarket') advance(state);
}

/** The finale popup was tapped away (also auto-dismissed by tickTutorial). */
export function dismissTutorialFinale(state) {
  if (currentTutorialStep(state) === 'finale') advance(state);
}

// --- view model ------------------------------------------------------------------

const world = (pos, y) => ({ kind: 'world', x: pos.x, z: pos.z, ...(y !== undefined ? { y } : {}) });
const tablet = (tab, element) => ({ kind: 'tablet', tab, element });

/**
 * What the tutorial overlay should show this frame: { id, text, anchor } or
 * null (tutorial over, or the current step is hidden with nothing to say).
 * A step still behind its gate returns its pendingView — the "earn $X more"
 * info banner for the affordability steps ({ kind:'info' }, pending:true), the
 * out-of-tires guard for firstBreak, or null. Text/anchor are dynamic for the
 * multi-leg steps (carry trips, the customer serve) so the highlight always
 * sits on the NEXT thing to do — the step itself never changes until its
 * condition completes.
 */
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

/**
 * What a still-gated step shows while waiting: the affordability steps show a
 * live "costs $X" info banner (pending:true, no highlight — the price falls
 * as a marker's own walk-up-to-pay drain pays it down, and the real highlight
 * takes over once affordable). getPaid(kind, index) reports how much of THAT
 * marker's cost is already drained via UnlockMarkers, subtracted from the
 * cost so the banner always shows the true remaining price, not the sticker
 * cost. firstBreak shows restock guidance if the pit runs dry while waiting
 * (no tires → no jobs → the break would never come — see TUTORIAL_STEPS'
 * note); everything else shows nothing.
 */
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
        // Still pending (the step completes on the break, not this restock),
        // but with a real world highlight rather than a passive banner.
        return { ...pitRestockView(state, id, 'Keep your worker supplied —'), pending: true };
      }
      return null;
    default:
      return null;
  }
}

/** The shelf→pit carry guidance for pit A, shared by firstRestock and
 * firstBreak's out-of-tires guard. `prefix` sets the urgency framing. */
function pitRestockView(state, id, prefix) {
  const p = settings.pit.positions[0];
  const carrying = state.player.carryingBox && state.player.carryingBoxPitIndex === 0;
  if (carrying) {
    return { id, text: 'Carry the box to your worker to restock the tires', anchor: world(p) };
  }
  const shelf = { x: p.x + settings.storage.shelfOffset.x, z: p.z + settings.storage.shelfOffset.z };
  return { id, text: `${prefix} grab a box from the shelf`, anchor: world(shelf) };
}

/**
 * The manual-fulfilment step's dynamic leg: point at whichever action serves
 * the front customer NEXT — the next needed in-stock shelf, then the checkout
 * once the bag is complete. Mirrors the level-0 flow in main.handleMarketTap.
 */
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

/** Lowest-stocked market shelf below capacity, or null if every shelf is full. */
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
