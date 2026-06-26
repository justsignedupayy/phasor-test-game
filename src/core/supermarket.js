/**
 * supermarket.js — the supermarket's customer + worker simulation. No Three.js.
 *
 *   tickSupermarket(state, dt)   advance everything: customer spawning/movement,
 *                                 checkout, and (once hired) the market worker's FSM.
 *   spawnCustomer(state)         create one customer with a random 1-5 item order.
 *   buyProduct(state, shelfIndex) gather that shelf's product toward the current
 *                                 order (player tap at level 0, or the worker).
 *   placeAtCheckout(state)       place the finished order at the counter.
 *   restockShelf(state, i)       refill a shelf to capacity.
 *   checkoutCustomer(state)      the served customer pays and starts walking out.
 *   hurryMarketWorker(state)     remote boost: temporarily speeds the market worker,
 *                                 mirroring simulation.js's per-pit hurry(state, i).
 *
 * Customer states: walkingIn -> waiting -> walkingToCheckout -> walkingOut (then
 * removed). Only the front-of-line customer (the first one fully 'waiting') is
 * ever served — checkoutBag/assemblingBag both key off its id, mirroring the
 * single-active-car-per-pit shape in simulation.js. Customers drive straight
 * through on z just like cars: in from settings.supermarket.customerEntryOutside
 * (a back-wall door), out through customerExitOutside (a separate front-wall
 * door) — see Garage.js's marketEntryDoor/marketExitDoor.
 *
 * Worker FSM (workerLevel >= 1): idle -> packaging (walk shelf-to-shelf
 * gathering the front order, then to the checkout) -> idle. workerLevel >= 2
 * adds restocking (walk to the outside box, then to the emptiest shelf) when
 * no customer needs packaging.
 */
import settings from '../config/settings.js';

// The market worker only bothers restocking a shelf once it's GENUINELY low —
// at or below half its capacity — instead of shuttling to the box pile the
// instant a single unit sells (which left it restocking near-full shelves in a
// near-constant loop). Topping off only happens below this fraction of capacity.
const RESTOCK_THRESHOLD_FRACTION = 0.1;

// --- shared movement -------------------------------------------------------

/**
 * Step a mover (anything with .position {x,z} and .rotation) toward target at
 * speed; updates rotation to face the travel direction. Returns true once it
 * has arrived (snapped exactly onto target).
 */
function moveToward(mover, target, speed, dt, epsilon) {
  const dx = target.x - mover.position.x;
  const dz = target.z - mover.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 1e-4) mover.rotation = Math.atan2(dx, dz);

  if (dist <= epsilon || speed * dt >= dist) {
    mover.position.x = target.x;
    mover.position.z = target.z;
    return true;
  }
  const step = speed * dt;
  mover.position.x += (dx / dist) * step;
  mover.position.z += (dz / dist) * step;
  return false;
}

/** Waiting-line slot i's world position (slot 0 = nearest the checkout). */
function queueSlotPosition(i) {
  const M = settings.supermarket;
  return { x: M.queueAnchor.x + i * M.queueStep.x, z: M.queueAnchor.z + i * M.queueStep.z };
}

/** How many customers still in line (walkingIn/waiting) precede this one. */
function lineIndexOf(state, customer) {
  let i = 0;
  for (const c of state.supermarket.customerQueue) {
    if (c === customer) return i;
    if (c.state === 'walkingIn' || c.state === 'waiting') i++;
  }
  return i;
}

/** The customer currently eligible to be served (first one fully walked in). */
export function frontCustomer(state) {
  return state.supermarket.customerQueue.find((c) => c.state === 'waiting') ?? null;
}

function bagComplete(items, request) {
  return Object.keys(request).every((type) => (items[type] || 0) >= request[type]);
}

/** Sum of price x quantity for a request/items map. */
export function computeTotal(items) {
  const P = settings.supermarket.products;
  let total = 0;
  for (const type in items) total += (P[type]?.price ?? 0) * items[type];
  return total;
}

/** The assembling bag for this customer, or null if none is in progress for them. */
function customerBag(state, customer) {
  const bag = state.supermarket.assemblingBag;
  return bag && bag.customerId === customer.id ? bag : null;
}

/** Does the worker currently hold ≥1 gathered item toward this customer's order? */
function bagHasItems(state, customer) {
  if (!customer) return false;
  const bag = customerBag(state, customer);
  if (!bag) return false;
  for (const type in bag.items) if (bag.items[type] > 0) return true;
  return false;
}

/**
 * Nearest shelf (by Euclidean distance from `from`) that the customer still
 * needs more of AND that has stock to gather, or null. Drives packaging routing
 * so the worker walks to whichever in-stock needed shelf is closest, not the
 * lowest product index.
 */
function nearestNeededShelfIndex(state, customer, from) {
  const S = state.supermarket;
  const positions = settings.supermarket.shelves;
  const bag = customerBag(state, customer);
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < S.shelves.length; i++) {
    const type = S.shelves[i].productType;
    const wanted = customer.request[type] || 0;
    const have = bag ? bag.items[type] || 0 : 0;
    if (wanted <= have) continue; // no longer needs this product
    if (S.shelves[i].stock <= 0) continue; // out of stock — nothing to gather here
    const d = Math.hypot(positions[i].x - from.x, positions[i].z - from.z);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** A shelf the customer still needs but that is empty (blocks the order until restocked), or null. */
function neededEmptyShelfIndex(state, customer) {
  const S = state.supermarket;
  const bag = customerBag(state, customer);
  for (let i = 0; i < S.shelves.length; i++) {
    const type = S.shelves[i].productType;
    const wanted = customer.request[type] || 0;
    const have = bag ? bag.items[type] || 0 : 0;
    if (wanted > have && S.shelves[i].stock <= 0) return i;
  }
  return null;
}

/** Lowest-stocked shelf below capacity, or null if every shelf is full. */
function emptiestShelfIndex(state) {
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

// --- customers --------------------------------------------------------------

/** Create one customer with a random 1-5 unit order (any mix of A/B/C/D). */
export function spawnCustomer(state) {
  const M = settings.supermarket;
  const types = Object.keys(M.products);
  const n = M.customerMinItems + Math.floor(Math.random() * (M.customerMaxItems - M.customerMinItems + 1));

  const request = {};
  for (let i = 0; i < n; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    request[type] = (request[type] || 0) + 1;
  }

  const customer = {
    id: state.supermarket.nextCustomerId++,
    request,
    state: 'walkingIn',
    position: { ...M.customerEntryOutside },
    rotation: 0,
    moving: true,
  };
  state.supermarket.customerQueue.push(customer);
  return customer;
}

function updateCustomerSpawning(state, dt) {
  const S = state.supermarket;
  const M = settings.supermarket;
  S.spawnTimer += dt;
  if (S.spawnTimer < M.customerSpawnInterval) return;
  if (S.customerQueue.length >= M.maxCustomerQueue) return; // kept full; retried each tick until there's room
  S.spawnTimer = 0;
  spawnCustomer(state);
}

function updateCustomers(state, dt) {
  const M = settings.supermarket;
  const S = state.supermarket;
  const q = S.customerQueue;

  for (let i = q.length - 1; i >= 0; i--) {
    const c = q[i];

    if (c.state === 'walkingIn' || c.state === 'waiting') {
      const target = queueSlotPosition(lineIndexOf(state, c));
      const arrived = moveToward(c, target, M.customerMoveSpeed, dt, M.arriveEpsilon);
      c.moving = !arrived;
      if (c.state === 'walkingIn' && arrived) c.state = 'waiting';
      if (S.checkoutBag && S.checkoutBag.customerId === c.id) {
        c.state = 'walkingToCheckout';
        c.moving = true;
      }
      continue;
    }

    if (c.state === 'walkingToCheckout') {
      const arrived = moveToward(c, M.checkoutPosition, M.customerMoveSpeed, dt, M.arriveEpsilon);
      c.moving = !arrived;
      if (arrived) checkoutCustomer(state);
      continue;
    }

    // walkingOut
    const arrived = moveToward(c, M.customerExitOutside, M.customerMoveSpeed, dt, M.arriveEpsilon);
    c.moving = !arrived;
    if (arrived) q.splice(i, 1);
  }
}

// --- player/worker actions ---------------------------------------------------

/** Gather as much of this shelf's product as the front order still needs. */
export function buyProduct(state, shelfIndex) {
  const S = state.supermarket;
  const shelf = S.shelves[shelfIndex];
  if (!shelf) return false;
  const customer = frontCustomer(state);
  if (!customer || S.checkoutBag) return false;

  let bag = S.assemblingBag;
  if (!bag || bag.customerId !== customer.id) {
    bag = { customerId: customer.id, items: {} };
    S.assemblingBag = bag;
  }

  const wanted = customer.request[shelf.productType] || 0;
  const have = bag.items[shelf.productType] || 0;
  const remaining = wanted - have;
  if (remaining <= 0) return false;

  const take = Math.min(remaining, shelf.stock);
  if (take <= 0) return false;

  shelf.stock -= take;
  bag.items[shelf.productType] = have + take;
  return true;
}

/** Place the fully-gathered order at the checkout counter. */
export function placeAtCheckout(state) {
  const S = state.supermarket;
  if (S.checkoutBag) return false; // counter occupied
  const customer = frontCustomer(state);
  const bag = S.assemblingBag;
  if (!customer || !bag || bag.customerId !== customer.id) return false;
  if (!bagComplete(bag.items, customer.request)) return false;

  S.checkoutBag = { customerId: customer.id, items: bag.items, total: computeTotal(customer.request) };
  S.assemblingBag = null;
  return true;
}

/** Refill a shelf to full capacity (called once a restock box has been delivered). */
export function restockShelf(state, shelfIndex) {
  const shelf = state.supermarket.shelves[shelfIndex];
  if (!shelf) return false;
  if (shelf.stock >= settings.supermarket.shelfCapacity) return false;
  shelf.stock = settings.supermarket.shelfCapacity;
  return true;
}

/** The served customer pays (cash goes straight to the player) and heads out. */
export function checkoutCustomer(state) {
  const S = state.supermarket;
  const bag = S.checkoutBag;
  if (!bag) return false;
  const customer = S.customerQueue.find((c) => c.id === bag.customerId);
  S.checkoutBag = null;
  if (!customer) return false;

  state.cash += bag.total;
  S.paidThisTick = bag.total;
  customer.state = 'walkingOut';
  customer.moving = true;
  return true;
}

// --- market worker (workerLevel >= 1) ---------------------------------------

/** A freshly hired worker: idle, standing at its spot near the shelves. */
export function createMarketWorker() {
  return {
    position: { ...settings.supermarket.workerIdleSpot },
    rotation: 0,
    moving: false,
    carrying: false,
    state: 'idle',
    phase: null,
    targetShelfIndex: null,
    _gatheredItem: false, // true once ≥1 order item is in hand this packaging trip (drives the carry clip + bag prop)
    hurryTimer: 0, // seconds of remaining speed boost, set by hurryMarketWorker (mirrors pit.hurryTimer)
  };
}

/** Remote hurry: tapping the worker from anywhere refreshes its boost window. */
export function hurryMarketWorker(state) {
  const w = state.supermarket.worker;
  if (!w) return;
  w.hurryTimer = settings.hurry.duration;
}

function updateWorker(state, dt) {
  const S = state.supermarket;
  const w = S.worker;
  if (!w) return;
  const M = settings.supermarket;

  if (w.hurryTimer > 0) w.hurryTimer = Math.max(0, w.hurryTimer - dt);
  const speed = M.workerMoveSpeed * (w.hurryTimer > 0 ? settings.hurry.multiplier : 1);

  if (w.phase === 'toShelf') {
    const target = M.shelves[w.targetShelfIndex];
    const arrived = moveToward(w, target, speed, dt, M.arriveEpsilon);
    w.moving = !arrived;
    w.carrying = true;
    if (arrived) {
      buyProduct(state, w.targetShelfIndex);
      w._gatheredItem = bagHasItems(state, frontCustomer(state));
      w.phase = null; // re-decide the next leg (nearest needed shelf / checkout / restock) from here
    }
    return;
  }

  if (w.phase === 'toCheckout') {
    const arrived = moveToward(w, M.checkoutPosition, speed, dt, M.arriveEpsilon);
    w.moving = !arrived;
    w.carrying = true;
    if (arrived) {
      placeAtCheckout(state);
      w.phase = null;
      w.carrying = false;
      w.state = 'idle';
      w._gatheredItem = false;
    }
    return;
  }

  if (w.phase === 'toBox') {
    const arrived = moveToward(w, S.restockBoxPosition, speed, dt, M.arriveEpsilon);
    w.moving = !arrived;
    if (arrived) {
      w.carrying = true;
      w.phase = 'toRestockShelf';
    }
    return;
  }

  if (w.phase === 'toRestockShelf') {
    const target = M.shelves[w.targetShelfIndex];
    const arrived = moveToward(w, target, speed, dt, M.arriveEpsilon);
    w.moving = !arrived;
    w.carrying = true;
    if (arrived) {
      restockShelf(state, w.targetShelfIndex);
      w.phase = null;
      w.carrying = false;
      w.state = 'idle';
    }
    return;
  }

  // Idle: decide the next job. Serving a waiting customer wins over routine
  // restocking; restocking only ever runs for a fully trained (level 2) worker.
  const customer = frontCustomer(state);
  if (customer && !S.checkoutBag) {
    // Walk to the nearest in-stock shelf the order still needs.
    const idx = nearestNeededShelfIndex(state, customer, w.position);
    if (idx !== null) {
      w.state = 'packaging';
      w.phase = 'toShelf';
      w.targetShelfIndex = idx;
      w._gatheredItem = bagHasItems(state, customer);
      return;
    }
    // Nothing left to gather in stock: either the order is complete (deliver it)
    // or it's blocked on an empty shelf. A blocked shelf must be restocked first
    // (level 2) — otherwise the worker would loop forever at the empty shelf.
    const bag = customerBag(state, customer);
    if (bag && bagComplete(bag.items, customer.request)) {
      w.state = 'packaging';
      w.phase = 'toCheckout';
      w.targetShelfIndex = null;
      w._gatheredItem = true;
      return;
    }
    if (S.workerLevel >= 2) {
      const blocked = neededEmptyShelfIndex(state, customer);
      if (blocked !== null) {
        w.state = 'restocking';
        w.phase = 'toBox';
        w.targetShelfIndex = blocked;
        w._gatheredItem = false;
        return;
      }
    }
    // A level-1 worker can't restock; with the order blocked there's nothing it
    // can do but wait for the player to refill, so it idles in place.
    w.state = 'idle';
    w.moving = false;
    w._gatheredItem = false;
    return;
  }
  if (S.workerLevel >= 2) {
    const idx = emptiestShelfIndex(state);
    const restockAt = M.shelfCapacity * RESTOCK_THRESHOLD_FRACTION;
    if (idx !== null && S.shelves[idx].stock <= restockAt) {
      w.state = 'restocking';
      w.phase = 'toBox';
      w.targetShelfIndex = idx;
      w._gatheredItem = false;
      return;
    }
  }
  // Idle in place: no job to do, so the worker stays exactly where its last task
  // left it (no walk back to a fixed idle spot) and drops straight into idle.
  w.state = 'idle';
  w.moving = false;
  w._gatheredItem = false;
}

// --- top-level tick -----------------------------------------------------------

export function tickSupermarket(state, dt) {
  // paidThisTick is a one-tick render signal (the scene pops "+$" at the
  // checkout when it's > 0); clear it before checkoutCustomer can set it.
  state.supermarket.paidThisTick = 0;
  if (!state.supermarket.unlocked) return;
  updateCustomerSpawning(state, dt);
  updateCustomers(state, dt);
  if (state.supermarket.workerLevel >= 1) updateWorker(state, dt);
}
