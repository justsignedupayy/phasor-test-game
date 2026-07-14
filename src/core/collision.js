import settings from '../config/settings.js';
import { pitLaneBoxes, pumpLaneBoxes } from './roads.js';

export function pushOutOfRect(pos, r, b) {
  const dx = pos.x - b.x;
  const dz = pos.z - b.z;
  const cx = Math.max(-b.halfX, Math.min(b.halfX, dx));
  const cz = Math.max(-b.halfZ, Math.min(b.halfZ, dz));
  const nx = dx - cx;
  const nz = dz - cz;
  const distSq = nx * nx + nz * nz;

  if (distSq > r * r) return; // gap wider than the radius — no overlap

  if (distSq > 1e-12) {
    const dist = Math.sqrt(distSq);
    const push = r - dist;
    pos.x += (nx / dist) * push;
    pos.z += (nz / dist) * push;
  } else {
    const penX = b.halfX - Math.abs(dx);
    const penZ = b.halfZ - Math.abs(dz);
    if (penX < penZ) {
      pos.x = b.x + (dx < 0 ? -1 : 1) * (b.halfX + r);
    } else {
      pos.z = b.z + (dz < 0 ? -1 : 1) * (b.halfZ + r);
    }
  }
}

export function buildObstacleList(state, settings, opts = {}) {
  const {
    market = true,
    garage = true,
    gas = garage, // gas pumps ride with the garage props (both are "world props", not market)
    allPits = false,
    excludePitIndex,
    excludePumpIndex,
    walls = [],
  } = opts;
  const M = settings.supermarket;
  const S = settings.storage;
  const boxes = [];

  for (const w of walls) boxes.push(w);

  if (market) {
    for (const shelf of M.shelves) {
      const freezer = shelf.model === 'freezer';
      const half = freezer ? M.freezerCollisionHalf : M.shelfCollisionHalf;
      const off = freezer ? M.freezerCollisionOffset : M.shelfCollisionOffset;
      boxes.push({ x: shelf.x + off.x, z: shelf.z + off.z, halfX: half.x, halfZ: half.z });
    }
    boxes.push({
      x: M.checkoutPosition.x,
      z: M.checkoutPosition.z,
      halfX: M.checkoutCollisionHalf.x,
      halfZ: M.checkoutCollisionHalf.z,
    });

    const W = settings.world;
    const corridorWallX = W.gateHalf + W.wallThickness / 2;
    const corridorZ = (-W.halfZ + M.deliveryDoorZ) / 2;
    const corridorHalfZ = (Math.abs(M.deliveryDoorZ) - W.halfZ) / 2;
    for (const side of [-1, 1]) {
      boxes.push({
        x: M.deliveryDoorX + side * corridorWallX,
        z: corridorZ,
        halfX: W.wallThickness / 2,
        halfZ: corridorHalfZ,
      });
    }
  }

  if (garage) {
    for (let i = 0; i < settings.pit.positions.length; i++) {
      if (i === excludePitIndex) continue;
      const pit = allPits ? null : state.pits[i];
      const p = settings.pit.positions[i];
      if (allPits || pit.equipped) {
        boxes.push({
          x: p.x + S.shelfOffset.x,
          z: p.z + S.shelfOffset.z,
          halfX: S.garageShelfCollisionHalf.x,
          halfZ: S.garageShelfCollisionHalf.z,
        });
        if (allPits || pit.tiresRemaining > 0) {
          boxes.push({
            x: p.x + S.tireOffset.x,
            z: p.z + S.tireOffset.z,
            halfX: S.tireCollisionHalf.x,
            halfZ: S.tireCollisionHalf.z,
          });
        }
        for (const b of pitLaneBoxes(i)) boxes.push(b);
      }
    }
  }

  if (gas) {
    const G = settings.gasStation;
    for (let i = 0; i < G.positions.length; i++) {
      if (i === excludePumpIndex) continue;
      const pump = allPits ? null : state.gasStation.pumps[i];
      if (allPits || pump.equipped) {
        const p = G.positions[i];
        boxes.push({
          x: p.x + G.pumpOffset.x,
          z: p.z + G.pumpOffset.z,
          halfX: G.pumpCollisionHalf.x,
          halfZ: G.pumpCollisionHalf.z,
        });
        const pumps = state ? state.gasStation.pumps : null;
        for (const b of pumpLaneBoxes(i, {
          prevEquipped: allPits || (i > 0 && pumps[i - 1].equipped),
          nextEquipped: allPits || (i + 1 < G.positions.length && pumps[i + 1].equipped),
        }))
          boxes.push(b);
      }
    }
  }

  return boxes;
}

export function roomWallBox(roomWallX) {
  const W = settings.world;
  const wall = settings.pit.pitWallCollisionHalf;
  return { x: roomWallX + W.wallThickness / 2, z: 0, halfX: wall.x, halfZ: wall.z };
}

export function resolveGarageCollisions(state, pos, r, opts = {}) {
  const walls = opts.roomWallX != null ? [roomWallBox(opts.roomWallX)] : [];
  const boxes = buildObstacleList(state, settings, {
    market: false,
    excludePitIndex: opts.excludePitIndex,
    excludePumpIndex: opts.excludePumpIndex,
    walls,
  });
  for (const b of boxes) pushOutOfRect(pos, r, b);
}

function cashRegisterBox() {
  const M = settings.supermarket;
  return {
    x: M.cashRegisterPosition.x,
    z: M.cashRegisterPosition.z,
    halfX: M.cashRegisterCollisionHalf.x,
    halfZ: M.cashRegisterCollisionHalf.z,
  };
}

export function resolveSupermarketCollisions(state, pos, r) {
  if (state.hasCashier) pushOutOfRect(pos, r, cashRegisterBox());
  if (!state.supermarket || !state.supermarket.unlocked) return;
  for (const b of buildObstacleList(state, settings, { garage: false })) pushOutOfRect(pos, r, b);
}
