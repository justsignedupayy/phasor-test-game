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
 * single-active-car-per-pit shape in simulation.js. Customers walk in from
 * settings.supermarket.customerEntryOutside and back out through
 * customerExitOutside — a separate door just to the entry's left, on the SAME
 * (back) wall, not a straight drive-through like the cars — see Garage.js's
 * marketEntryDoor/marketExitDoor.
 *
 * Worker FSM (workerLevel >= 1): idle -> packaging (walk shelf-to-shelf
 * gathering the front order, then to the checkout) -> idle. workerLevel >= 2
 * adds restocking (walk to the restock box, then to the emptiest shelf) when
 * no customer needs packaging and the box still has a unit to carry.
 */
import settings from '../config/settings.js';
import { grid, findPath } from './pathfinding.js';
import { resolveGarageCollisions } from './collision.js';
import { createBreakState, tickBreak, incrementJobCount } from './breaks.js';

// Every market NPC (worker + customers) shares the player's body radius — they all
// clone the same character model. Obstacle inflation in the pathfinding grid uses
// this same radius, and it's the separation distance for agent-agent overlap.
const NPC_RADIUS = settings.player.radius;

// The market worker only bothers restocking a shelf once it's GENUINELY low —
// at or below this fraction of its capacity — instead of shuttling to the box
// pile the instant a single unit sells (which left it restocking near-full
// shelves in a near-constant loop).
const RESTOCK_THRESHOLD_FRACTION = 0.1;

// --- shared movement (A* waypoint following) -------------------------------

// Distance at which a waypoint counts as reached. Kept to half a cell so the mover
// hugs the A* cell centres closely — a larger value lets it cut corners and graze the
// inflated obstacle margin it was routed clear of (a few cm into the checkout box).
const WP_REACH = settings.pathfinding.cellSize * 0.5;

/** Two points (essentially) the same spot — used to detect a target change. */
function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.z - b.z) < 1e-3;
}

/** Drop a mover's cached route (on arrival, so the next target replans). */
function clearPath(mover) {
  mover._path = undefined;
  mover._pathTarget = undefined;
  mover._pathIndex = 0;
}

/**
 * Plan a mover's route to target — normally plain A* (findPath), with one special
 * case that threads a mandatory gap waypoint first:
 *
 *  • Customer EXIT (target = the outside exit point): A* to the BACK-wall exit-door
 *    gap { marketExitX, halfZ } — which routes the customer AROUND the inflated
 *    checkout box instead of straight through it — then a direct leg out through the
 *    gap. (Entry needs none: its straight path already clears the box and its own door.)
 *
 *  • Crossing the FRONT wall (the restock box sits on the exterior dock just
 *    outside it): thread the delivery-door gate { deliveryDoorX, -halfZ } between
 *    the in-room A* leg and the straight off-grid leg, in either direction —
 *    handled by the front-gate case below.
 *
 * Every special route still uses findPath for the in-room leg, so the A* grid is
 * the single source of static obstacle avoidance; only the gap waypoint is
 * threaded in.
 */
function planRoute(mover, target) {
  const W = settings.world;
  const M = settings.supermarket;
  const pos = mover.position;

  // Customer leaving: A* to the exit door (routes around the checkout box), then out.
  if (samePoint(target, M.customerExitOutside)) {
    const exitDoor = { x: M.marketExitX, z: W.halfZ };
    const toDoor = findPath(grid, pos, exitDoor);
    return toDoor ? [...toDoor, exitDoor] : [exitDoor];
  }

  // Crossing the FRONT wall (the restock box sits just outside it) now that the
  // wall is solid except at the delivery-door gate: thread that gate so the route
  // honours the wall instead of walking through it. The off-wall leg is a straight
  // shot (no A* grid out there) — same shape as the customer-exit case above, just
  // through the front gate, and handling both directions (out to the box / back in).
  const frontGate = { x: M.deliveryDoorX, z: -W.halfZ };
  const targetOutsideFront = target.z < -W.halfZ;
  const posOutsideFront = pos.z < -W.halfZ;
  if (targetOutsideFront && !posOutsideFront) {
    const toGate = findPath(grid, pos, frontGate);
    return toGate ? [...toGate, frontGate] : [frontGate];
  }
  if (posOutsideFront && !targetOutsideFront) {
    const fromGate = findPath(grid, frontGate, target);
    return fromGate ? [frontGate, ...fromGate] : [frontGate];
  }

  return findPath(grid, pos, target);
}

/**
 * Move one market NPC toward `target`, routing around static obstacles via A*. The
 * single routing point for every customer/worker move. Returns true once arrived
 * (so callers drive `.moving` and their FSM transitions exactly as before).
 *
 *  • On a target change, request a fresh path (findPath) and cache it on the mover.
 *    A null path (target/start off the grid, e.g. a customer's outside door) falls
 *    back to moving straight at the target.
 *  • Each frame, move toward the next waypoint; advance the cursor once within
 *    WP_REACH of it. With all waypoints consumed (or on a direct path) it heads to
 *    the real target — A* stops at the edge of an inflated obstacle, so this last
 *    short leg walks the NPC onto its actual interaction spot.
 *  • Arrival is judged BEFORE movement (against the real target) so the FSM advances
 *    the instant the NPC lands on it. A per-frame cap keeps any step ≤ speed*dt.
 */
function waypointNpc(state, mover, target, speed, dt) {
  const eps = settings.supermarket.arriveEpsilon;
  const step = speed * dt;

  if (!mover._pathTarget || !samePoint(mover._pathTarget, target)) {
    mover._path = planRoute(mover, target);
    mover._pathTarget = { x: target.x, z: target.z };
    mover._pathIndex = 0;
  }

  const fromX = mover.position.x;
  const fromZ = mover.position.z;

  // Advance the cursor past every waypoint already reached this frame.
  const path = mover._path;
  if (path && path.length) {
    while (mover._pathIndex < path.length) {
      const wp = path[mover._pathIndex];
      if (Math.hypot(wp.x - mover.position.x, wp.z - mover.position.z) <= WP_REACH) mover._pathIndex++;
      else break;
    }
  }
  const onFinalLeg = !path || !path.length || mover._pathIndex >= path.length;

  // Arrival (before movement): snap onto the real target, clear the route.
  const dxT = target.x - mover.position.x;
  const dzT = target.z - mover.position.z;
  const distT = Math.hypot(dxT, dzT);
  if (onFinalLeg && (distT <= eps || step >= distT)) {
    if (distT > 1e-4) mover.rotation = Math.atan2(dxT, dzT);
    mover.position.x = target.x;
    mover.position.z = target.z;
    clearPath(mover);
    return true;
  }

  // Step toward the immediate sub-goal: next waypoint, or the real target.
  const goal = onFinalLeg ? target : path[mover._pathIndex];
  const gx = goal.x - mover.position.x;
  const gz = goal.z - mover.position.z;
  const gd = Math.hypot(gx, gz);
  if (gd > 1e-4) {
    mover.rotation = Math.atan2(gx, gz);
    const m = Math.min(step, gd);
    mover.position.x += (gx / gd) * m;
    mover.position.z += (gz / gd) * m;
  }

  // A null path means a direct moveToward with no A* wall routing (an off-grid
  // target: a customer's outside door). Enforce the world bounds here so the mover
  // can't walk through a solid wall. Applied before the cap below, so any clamp
  // correction is smoothed to ≤ speed*dt.
  if (!path) clampFallbackToWalls(mover.position, NPC_RADIUS, target);

  // Per-frame displacement cap (the step above is already ≤ speed*dt; this guards
  // against any future addition shoving the NPC further than its speed allows).
  const ddx = mover.position.x - fromX;
  const ddz = mover.position.z - fromZ;
  const moved = Math.hypot(ddx, ddz);
  if (moved > step) {
    mover.position.x = fromX + (ddx / moved) * step;
    mover.position.z = fromZ + (ddz / moved) * step;
  }
  return false;
}

/**
 * Wall clamp for the null-path direct fallback. Enforces ALL FOUR walls, mirroring
 * simulation.clampToBounds (left/right via the x bound, front/back via the z bound).
 *
 * Crossing is gated STRICTLY by door x: a mover may only pass through a wall while it
 * is within gateHalf of that wall's door — the front (-z) wall's delivery gate
 * (deliveryDoorX), or the back (+z) wall's customer entry/exit doors (marketX /
 * marketExitX). Everywhere else those walls are completely solid. The earlier
 * "target lies past the wall" / "pos already past the wall by any epsilon" relaxations
 * are gone: they opened the whole wall at every x (the target term) or let a one-frame
 * penetration self-justify (clamp threshold == relaxation threshold), which is what let
 * movers walk through the wall anywhere. The gate band is enforced against the true wall
 * plane (halfZ), a full radius beyond the clamp (limZ), so a mover can only get past the
 * clamp line at all while standing in the gate; once fully past the wall plane it is on
 * the far side and moves freely there. Left/right walls are always solid.
 */
function clampFallbackToWalls(pos, r, target) {
  const W = settings.world;
  const M = settings.supermarket;
  const g = W.gateHalf;
  const limX = W.halfX - r;
  const limZ = W.halfZ - r;

  // Left + right walls: always solid (mirrors clampToBounds' x clamp). Market NPCs
  // never reach the bay's right fence, so the full-width halfX bound is the wall here.
  pos.x = Math.max(-limX, Math.min(limX, pos.x));

  // Front (-z) + back (+z) walls: solid except within gateHalf of that wall's door x.
  const atFrontGate = Math.abs(pos.x - M.deliveryDoorX) <= g;
  const atBackGate = Math.abs(pos.x - M.marketX) <= g || Math.abs(pos.x - M.marketExitX) <= g;
  const crossingBack = atBackGate || pos.z > W.halfZ;
  const crossingFront = atFrontGate || pos.z < -W.halfZ;
  if (!crossingBack && pos.z > limZ) pos.z = limZ;
  if (!crossingFront && pos.z < -limZ) pos.z = -limZ;
}

/**
 * Light dynamic agent-agent separation: push apart any two NPCs (worker +
 * customers) whose bodies overlap, but ONLY while BOTH are in transit (`.moving`).
 * A settled agent standing on its interaction spot (a waiting customer, the worker
 * at the checkout) is never disturbed and never blocks another agent's arrival, so
 * this can't stall the FSM. Static obstacles are handled by A*, not here.
 *
 * As a final net it also pushes every in-transit agent out of any garage prop
 * (shelves/tires/chairs) it overlaps — a safety backstop to the A* grid, which
 * already routes them clear. Market NPCs stay in the left lobby, well clear of the
 * pit row, so in practice this never fires; it just guarantees no clipping if a
 * future NPC navigates the garage proper.
 */
function separateMovingAgents(state) {
  const S = state.supermarket;
  const agents = S.worker ? [...S.customerQueue, S.worker] : S.customerQueue;

  for (const a of agents) {
    if (a.moving) resolveGarageCollisions(state, a.position, NPC_RADIUS);
  }

  const minDist = 2 * NPC_RADIUS;
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i];
      const b = agents[j];
      if (!a.moving || !b.moving) continue;
      let dx = b.position.x - a.position.x;
      let dz = b.position.z - a.position.z;
      let d = Math.hypot(dx, dz);
      if (d >= minDist) continue;
      if (d < 1e-4) {
        dx = 1;
        dz = 0;
        d = 1;
      } // coincident — separate along an arbitrary axis
      const push = (minDist - d) / 2;
      const nx = dx / d;
      const nz = dz / d;
      a.position.x -= nx * push;
      a.position.z -= nz * push;
      b.position.x += nx * push;
      b.position.z += nz * push;
    }
  }
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

/**
 * A tint for a freshly spawned customer, never the one the immediately preceding
 * customer got — without this, a customer walking out through the exit and the
 * next one walking in through the entry (same model, same tint) read as the same
 * person doing a loop. See settings.character.customerTints.
 */
function pickCustomerTint(state) {
  const palette = settings.character.customerTints;
  const last = state.supermarket.lastCustomerTint;
  const choices = palette.length > 1 ? palette.filter((t) => t !== last) : palette;
  const tint = choices[Math.floor(Math.random() * choices.length)];
  state.supermarket.lastCustomerTint = tint;
  return tint;
}

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
    tint: pickCustomerTint(state),
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
      const arrived = waypointNpc(state, c, target, M.customerMoveSpeed, dt);
      c.moving = !arrived;
      if (c.state === 'walkingIn' && arrived) c.state = 'waiting';
      if (S.checkoutBag && S.checkoutBag.customerId === c.id) {
        c.state = 'walkingToCheckout';
        c.moving = true;
      }
      continue;
    }

    if (c.state === 'walkingToCheckout') {
      // Stand in FRONT of the checkout (customerCheckoutSpot), not on its centre, so
      // the customer never clips through the counter mesh on the final approach.
      const arrived = waypointNpc(state, c, M.customerCheckoutSpot, M.customerMoveSpeed, dt);
      c.moving = !arrived;
      if (arrived) checkoutCustomer(state);
      continue;
    }

    // walkingOut
    const arrived = waypointNpc(state, c, M.customerExitOutside, M.customerMoveSpeed, dt);
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
  // One delivered customer = one job toward the market worker's break (the
  // worker exists only at workerLevel >= 1; at level 0 the player serves).
  if (S.worker) incrementJobCount(S.worker.break);
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
    break: createBreakState('marketWorker'), // its own break clock (see core/breaks.js)
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
  tickBreak(w.break, dt); // advance a running break; may auto-end it this frame
  const speed = M.workerMoveSpeed * (w.hurryTimer > 0 ? settings.hurry.multiplier : 1);

  if (w.phase === 'toShelf') {
    const target = M.shelves[w.targetShelfIndex];
    const arrived = waypointNpc(state, w, target, speed, dt);
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
    // Deliver from a spot offset off the checkout centre so the worker doesn't
    // path onto the customer standing there. The customer still targets checkoutPosition.
    const deliverSpot = {
      x: M.checkoutPosition.x + M.workerCheckoutOffset.x,
      z: M.checkoutPosition.z + M.workerCheckoutOffset.z,
    };
    const arrived = waypointNpc(state, w, deliverSpot, speed, dt);
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
    const arrived = waypointNpc(state, w, S.restockBoxPosition, speed, dt);
    w.moving = !arrived;
    if (arrived) {
      // Take one unit out of the box to carry to the shelf. If it emptied between
      // deciding to restock and arriving (e.g. the player grabbed the last unit),
      // abort and drop back to idle — the worker waits for the next delivery.
      if (takeRestockUnit(state)) {
        w.carrying = true;
        w.phase = 'toRestockShelf';
      } else {
        w.phase = null;
        w.carrying = false;
        w.state = 'idle';
      }
    }
    return;
  }

  if (w.phase === 'toRestockShelf') {
    const target = M.shelves[w.targetShelfIndex];
    const arrived = waypointNpc(state, w, target, speed, dt);
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

  // On break: the worker has finished its last task (it only reaches this idle
  // decision with no phase in progress), so it now walks to its chair and sits.
  // Customers/queue keep building meanwhile — exactly like an idle worker with
  // no job, just seated. tickBreak (above) ends the break automatically; an ad
  // can end it early (endBreak). It then drops straight back into normal work.
  if (w.break.onBreak) {
    const B = settings.breaks;
    const arrived = waypointNpc(state, w, B.marketChairPosition, speed, dt);
    w.moving = !arrived;
    w.state = 'onBreak';
    w.carrying = false;
    w._gatheredItem = false;
    if (arrived) w.rotation = B.marketChairFacing; // settle into the seat's facing
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
    if (S.workerLevel >= 2 && S.restockBox.units > 0) {
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
  if (S.workerLevel >= 2 && S.restockBox.units > 0) {
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

// --- restock box + delivery truck -------------------------------------------

/** Seconds between truck deliveries at the current "Faster Deliveries" level. */
export function truckDeliveryInterval(state) {
  const intervals = settings.supermarket.truck.intervals;
  const lvl = Math.min(state.supermarket.truckUpgradeLevel, intervals.length - 1);
  return intervals[lvl];
}

/**
 * Take one unit out of the restock box (one unit = one full shelf refill).
 * Returns false (taking nothing) when the box is empty — the caller then can't
 * restock until the next truck arrives.
 */
export function takeRestockUnit(state) {
  const box = state.supermarket.restockBox;
  if (box.units <= 0) return false;
  box.units -= 1;
  return true;
}

/**
 * Advance the delivery-truck clock. Once truckTimer reaches the current interval
 * a truck is dispatched (truckArriving = true) and the timer resets; the scene
 * plays the drive-in and calls deliverStock() when it lands. While a truck is in
 * flight the timer holds, so the next interval only starts counting after the
 * delivery completes.
 */
export function tickTruck(state, dt) {
  const S = state.supermarket;
  if (S.truckArriving) return; // a truck is already on its way — hold the clock
  S.truckTimer += dt;
  if (S.truckTimer >= truckDeliveryInterval(state)) {
    S.truckArriving = true;
    S.truckTimer = 0;
  }
}

/**
 * The truck finished its drive-in: top the box back up to maxUnits (never past
 * it) and clear truckArriving so the delivery clock resumes. Called by the scene
 * (TruckView) at the drive-in → wait transition.
 */
export function deliverStock(state) {
  const box = state.supermarket.restockBox;
  box.units = Math.min(box.units + box.maxUnits, box.maxUnits);
  state.supermarket.truckArriving = false;
}

/**
 * Summon the truck immediately (the rewarded-ad "Call Truck Early" path): fast-
 * forward the clock so the very next tickTruck dispatches a delivery. No-op if a
 * truck is already in flight.
 */
export function callTruckEarly(state) {
  if (state.supermarket.truckArriving) return;
  state.supermarket.truckTimer = truckDeliveryInterval(state);
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
  tickTruck(state, dt); // advance the delivery-truck clock; dispatches on interval
  separateMovingAgents(state); // light agent-agent overlap net, after everyone has moved
}
