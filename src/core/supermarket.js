import settings from '../config/settings.js';
import { grid, findPath } from './pathfinding.js';
import { resolveGarageCollisions } from './collision.js';
import { createBreakState, tickBreak, incrementJobCount } from './breaks.js';

const NPC_RADIUS = settings.player.radius;

const RESTOCK_THRESHOLD_FRACTION = 0.1;

const WP_REACH = settings.pathfinding.cellSize * 0.5;

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.z - b.z) < 1e-3;
}

function clearPath(mover) {
  mover._path = undefined;
  mover._pathTarget = undefined;
  mover._pathIndex = 0;
}

function planRoute(mover, target) {
  const W = settings.world;
  const M = settings.supermarket;
  const pos = mover.position;

  if (samePoint(target, M.customerExitOutside)) {
    const exitDoor = { x: M.marketExitX, z: W.halfZ };
    const toDoor = findPath(grid, pos, exitDoor);
    return toDoor ? [...toDoor, exitDoor] : [exitDoor];
  }

  if (pos.z > W.halfZ && target.z < W.halfZ) {
    const entryMouth = { x: M.marketX, z: W.halfZ };
    const fromMouth = findPath(grid, entryMouth, target);
    return fromMouth ? [entryMouth, ...fromMouth] : [entryMouth];
  }

  const frontGate = { x: M.deliveryDoorX, z: -W.halfZ };
  const targetOutsideFront = target.z < -W.halfZ;
  const posOutsideFront = pos.z < -W.halfZ;
  if (targetOutsideFront && !posOutsideFront) {
    const toGate = findPath(grid, pos, frontGate);
    return toGate ? [...toGate, frontGate, M.deliveryDoorOutside] : [frontGate, M.deliveryDoorOutside];
  }
  if (posOutsideFront && !targetOutsideFront) {
    const fromGate = findPath(grid, frontGate, target);
    const head = pos.z < M.deliveryDoorZ ? [M.deliveryDoorOutside, frontGate] : [frontGate];
    return fromGate ? [...head, ...fromGate] : head;
  }

  return findPath(grid, pos, target);
}

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

  const path = mover._path;
  if (path && path.length) {
    while (mover._pathIndex < path.length) {
      const wp = path[mover._pathIndex];
      if (Math.hypot(wp.x - mover.position.x, wp.z - mover.position.z) <= WP_REACH) mover._pathIndex++;
      else break;
    }
  }
  const onFinalLeg = !path || !path.length || mover._pathIndex >= path.length;

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

  if (!path) clampFallbackToWalls(mover.position, NPC_RADIUS, target);

  const ddx = mover.position.x - fromX;
  const ddz = mover.position.z - fromZ;
  const moved = Math.hypot(ddx, ddz);
  if (moved > step) {
    mover.position.x = fromX + (ddx / moved) * step;
    mover.position.z = fromZ + (ddz / moved) * step;
  }
  return false;
}

function clampFallbackToWalls(pos, r, target) {
  const W = settings.world;
  const M = settings.supermarket;
  const g = W.gateHalf;
  const t = W.wallThickness;
  const limX = W.halfX - r;
  const limZ = W.halfZ - r;

  pos.x = Math.max(-limX, Math.min(limX, pos.x));

  const atFrontGate = Math.abs(pos.x - M.deliveryDoorX) <= g;
  const atBackGate = Math.abs(pos.x - M.marketX) <= g || Math.abs(pos.x - M.marketExitX) <= g;
  if (!atBackGate) {
    if (pos.z < W.halfZ + t / 2) pos.z = Math.min(limZ, pos.z); // inside: held off the inner face
    else pos.z = Math.max(W.halfZ + t + r, pos.z); // outside: held off the outer face
  }
  if (!atFrontGate) {
    if (pos.z > -W.halfZ - t / 2) pos.z = Math.max(-limZ, pos.z);
    else pos.z = Math.min(-W.halfZ - t - r, pos.z);
  }
}

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

function queueSlotPosition(i) {
  const M = settings.supermarket;
  return { x: M.queueAnchor.x + i * M.queueStep.x, z: M.queueAnchor.z + i * M.queueStep.z };
}

function lineIndexOf(state, customer) {
  let i = 0;
  for (const c of state.supermarket.customerQueue) {
    if (c === customer) return i;
    if (c.state === 'walkingIn' || c.state === 'waiting') i++;
  }
  return i;
}

export function frontCustomer(state) {
  return state.supermarket.customerQueue.find((c) => c.state === 'waiting') ?? null;
}

function bagComplete(items, request) {
  return Object.keys(request).every((type) => (items[type] || 0) >= request[type]);
}

export function computeTotal(items) {
  const P = settings.supermarket.products;
  let total = 0;
  for (const type in items) total += (P[type]?.price ?? 0) * items[type];
  return total;
}

function customerBag(state, customer) {
  const bag = state.supermarket.assemblingBag;
  return bag && bag.customerId === customer.id ? bag : null;
}

function bagHasItems(state, customer) {
  if (!customer) return false;
  const bag = customerBag(state, customer);
  if (!bag) return false;
  for (const type in bag.items) if (bag.items[type] > 0) return true;
  return false;
}

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

function pickCustomerTint(state) {
  const palette = settings.character.customerTints;
  const last = state.supermarket.lastCustomerTint;
  const choices = palette.length > 1 ? palette.filter((t) => t !== last) : palette;
  const tint = choices[Math.floor(Math.random() * choices.length)];
  state.supermarket.lastCustomerTint = tint;
  return tint;
}

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
      const arrived = waypointNpc(state, c, M.customerCheckoutSpot, M.customerMoveSpeed, dt);
      c.moving = !arrived;
      if (arrived) checkoutCustomer(state);
      continue;
    }

    const arrived = waypointNpc(state, c, M.customerExitOutside, M.customerMoveSpeed, dt);
    c.moving = !arrived;
    if (arrived) q.splice(i, 1);
  }
}

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

export function restockShelf(state, shelfIndex) {
  const shelf = state.supermarket.shelves[shelfIndex];
  if (!shelf) return false;
  if (shelf.stock >= settings.supermarket.shelfCapacity) return false;
  shelf.stock = settings.supermarket.shelfCapacity;
  return true;
}

export function checkoutCustomer(state) {
  const S = state.supermarket;
  const bag = S.checkoutBag;
  if (!bag) return false;
  const customer = S.customerQueue.find((c) => c.id === bag.customerId);
  S.checkoutBag = null;
  if (!customer) return false;

  state.cash += bag.total;
  S.paidThisTick = bag.total;
  if (S.worker) incrementJobCount(S.worker.break, state);
  customer.state = 'walkingOut';
  customer.moving = true;
  return true;
}

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

export function hurryMarketWorker(state) {
  const w = state.supermarket.worker;
  if (!w || w.break.onBreak) return;
  w.hurryTimer = settings.hurry.duration;
}

function updateWorker(state, dt) {
  const S = state.supermarket;
  const w = S.worker;
  if (!w) return;
  const M = settings.supermarket;

  if (w.hurryTimer > 0) w.hurryTimer = Math.max(0, w.hurryTimer - dt);
  tickBreak(w.break, dt, state); // advance a running break; may auto-end it this frame
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

  if (w.break.onBreak) {
    const B = settings.breaks;
    const arrived = waypointNpc(state, w, B.marketBreakSpot, speed, dt);
    w.moving = !arrived;
    w.state = 'onBreak';
    w.carrying = false;
    w._gatheredItem = false;
    if (arrived) w.rotation = B.marketBreakSpotFacing; // settle into the spot's facing
    return;
  }

  const customer = frontCustomer(state);
  if (customer && !S.checkoutBag) {
    const idx = nearestNeededShelfIndex(state, customer, w.position);
    if (idx !== null) {
      w.state = 'packaging';
      w.phase = 'toShelf';
      w.targetShelfIndex = idx;
      w._gatheredItem = bagHasItems(state, customer);
      return;
    }
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
  w.state = 'idle';
  w.moving = false;
  w._gatheredItem = false;
}

const MAX_TRUCK_LEVEL = settings.supermarket.truck.deliveryTimes.length - 1;

export function truckDeliveryTime(state) {
  const times = settings.supermarket.truck.deliveryTimes;
  const lvl = Math.min(state.supermarket.truckUpgradeLevel, MAX_TRUCK_LEVEL);
  return times[lvl];
}

export function takeRestockUnit(state) {
  const box = state.supermarket.restockBox;
  if (box.units <= 0) return false;
  box.units -= 1;
  return true;
}

export function orderTruck(state) {
  const S = state.supermarket;
  if (!S.unlocked || S.truckOrdered || S.truckArriving) return false;
  if (S.restockBox.units >= S.restockBox.maxUnits) return false;
  S.truckOrdered = true;
  S.truckTimer = 0;
  return true;
}

export function tickTruck(state, dt) {
  const S = state.supermarket;
  if (S.truckUpgradeLevel >= MAX_TRUCK_LEVEL && S.restockBox.units <= 0) {
    orderTruck(state); // no-op if already ordered / in flight
  }
  if (!S.truckOrdered || S.truckArriving) return;
  S.truckTimer += dt;
  if (S.truckTimer >= truckDeliveryTime(state)) {
    S.truckArriving = true;
    S.truckOrdered = false;
    S.truckTimer = 0;
  }
}

export function deliverStock(state) {
  const box = state.supermarket.restockBox;
  box.units = Math.min(box.units + box.maxUnits, box.maxUnits);
  state.supermarket.truckArriving = false;
}

export function callTruckEarly(state) {
  const S = state.supermarket;
  if (!S.truckOrdered || S.truckArriving) return;
  S.truckTimer = truckDeliveryTime(state);
}

export function tickSupermarket(state, dt) {
  state.supermarket.paidThisTick = 0;
  if (!state.supermarket.unlocked) return;
  updateCustomerSpawning(state, dt);
  updateCustomers(state, dt);
  if (state.supermarket.workerLevel >= 1) updateWorker(state, dt);
  tickTruck(state, dt); // advance a placed order's clock (auto-orders at max level); dispatches when due
  separateMovingAgents(state); // light agent-agent overlap net, after everyone has moved
}
