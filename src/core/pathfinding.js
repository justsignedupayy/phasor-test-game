/**
 * pathfinding.js — static A* navigation for the supermarket NPCs. No Three.js.
 *
 * The supermarket floor is discretised into a 2D walkability grid ONCE at module
 * load (obstacles are static). Each cell is blocked if it falls within NPC_RADIUS
 * of any obstacle — the four shelves/freezers, the checkout counter, and the
 * world walls — i.e. standard A* obstacle inflation, so a path planned on cell
 * CENTRES still keeps the NPC's body clear of every corner.
 *
 *   buildGrid(settings)            build the grid (exported for tests/tuning).
 *   findPath(grid, fromXZ, toXZ)   A* (Euclidean heuristic, 8-connected, no corner
 *                                   cutting). Returns {x,z} waypoints from start to
 *                                   target, [] if already in the target cell, or
 *                                   null if unreachable (e.g. an endpoint lies
 *                                   outside the grid — the caller then walks direct).
 *
 * A ready-built `grid` for the live settings is exported too; steering imports it.
 */
import settings from '../config/settings.js';
import { buildObstacleList } from './collision.js';

const NPC_RADIUS = settings.player.radius;

/**
 * Build the inflated walkability grid from world bounds + market obstacle boxes.
 * `extraBoxes` ({ x, z, halfX, halfZ }) are dynamic obstacles that change with game
 * state (the room's right/fence wall, which moves as pits unlock) — passed in by
 * rebuildGrid so this stays a pure function of its arguments.
 */
export function buildGrid(s, extraBoxes = []) {
  const W = s.world;
  const M = s.supermarket;
  const cellSize = s.pathfinding.cellSize;
  const minX = -W.halfX;
  const minZ = -W.halfZ;
  const cols = Math.ceil((W.halfX * 2) / cellSize);
  const rows = Math.ceil((W.halfZ * 2) / cellSize);
  const blocked = new Uint8Array(cols * rows);
  const r = NPC_RADIUS;

  // Obstacle rectangles { x, z, halfX, halfZ } from the shared geometry builder — the
  // SAME list (market shelves/freezers/checkout + every pit's shelf/tire/chair) the
  // player/mechanic push-out uses, so the grid and that safety net can never drift.
  // allPits: the grid is state-free, so it bakes in every pit's props (harmless —
  // market NPCs never reach the bay row). The moving fence wall arrives as extraBoxes.
  const rects = buildObstacleList(null, s, { allPits: true, walls: extraBoxes });

  // Door gaps: a boundary cell within gateHalf of a door's x on that wall stays
  // walkable, so NPCs can route THROUGH the gate via A* instead of only the direct
  // fallback. Front wall (z = -halfZ): the supermarket delivery/restock gate
  // (deliveryDoorX). Back wall (z = +halfZ): the customer entry (marketX) + exit
  // (marketExitX) doors. Mirrors the gate gaps Garage.js carves in the wall meshes.
  const g = W.gateHalf;
  const frontDoorXs = [M.deliveryDoorX];
  const backDoorXs = [M.marketX, M.marketExitX];
  const inGap = (xs, cx) => xs.some((dx) => Math.abs(cx - dx) <= g);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = minX + (col + 0.5) * cellSize;
      const cz = minZ + (row + 0.5) * cellSize;
      // Walls: inflate the room boundary inward by r (out-of-bounds cells
      // unwalkable), but leave each door's gate cells open.
      const nearLeft = cx < minX + r;
      const nearRight = cx > W.halfX - r;
      const nearFront = cz < minZ + r;
      const nearBack = cz > W.halfZ - r;
      let block =
        nearLeft ||
        nearRight ||
        (nearFront && !inGap(frontDoorXs, cx)) ||
        (nearBack && !inGap(backDoorXs, cx));
      if (!block) {
        for (const b of rects) {
          if (Math.abs(cx - b.x) <= b.halfX + r && Math.abs(cz - b.z) <= b.halfZ + r) {
            block = true;
            break;
          }
        }
      }
      blocked[row * cols + col] = block ? 1 : 0;
    }
  }
  return { minX, minZ, cols, rows, cellSize, blocked };
}

function cellOf(grid, p) {
  let col = Math.floor((p.x - grid.minX) / grid.cellSize);
  let row = Math.floor((p.z - grid.minZ) / grid.cellSize);
  // The lower grid boundary is naturally inclusive (floor() puts it in cell 0);
  // a point sitting exactly ON the upper boundary (e.g. a door gate at +halfX/
  // +halfZ) floors to one-past-the-last cell, so snap it back in to match.
  if (col === grid.cols) col = grid.cols - 1;
  if (row === grid.rows) row = grid.rows - 1;
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return null;
  return { col, row };
}

function cellCenter(grid, col, row) {
  return { x: grid.minX + (col + 0.5) * grid.cellSize, z: grid.minZ + (row + 0.5) * grid.cellSize };
}

function walkable(grid, col, row) {
  return (
    col >= 0 && col < grid.cols && row >= 0 && row < grid.rows && grid.blocked[row * grid.cols + col] === 0
  );
}

/** Nearest walkable cell to (col,row) by expanding square rings, or null if none. */
function nearestWalkable(grid, col, row) {
  if (walkable(grid, col, row)) return { col, row };
  const maxR = Math.max(grid.cols, grid.rows);
  for (let rad = 1; rad <= maxR; rad++) {
    for (let dc = -rad; dc <= rad; dc++) {
      for (let dr = -rad; dr <= rad; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue; // ring perimeter only
        if (walkable(grid, col + dc, row + dr)) return { col: col + dc, row: row + dr };
      }
    }
  }
  return null;
}

const NEIGHBORS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * A* from `from` to `to`. Returns an array of {x,z} cell-centre waypoints (last one
 * the cell nearest the target), [] if already in the target cell, or null if there
 * is no path or an endpoint is off-grid. The start cell is allowed even if it is
 * itself blocked (an NPC can stand on its interaction target, which is an inflated
 * cell), so it can always step out toward open floor.
 */
export function findPath(grid, from, to) {
  const start = cellOf(grid, from);
  const goalRaw = cellOf(grid, to);
  if (!start || !goalRaw) return null; // endpoint outside the grid → caller walks direct

  const goal = nearestWalkable(grid, goalRaw.col, goalRaw.row);
  if (!goal) return null;
  if (start.col === goal.col && start.row === goal.row) return []; // already in the goal cell

  const cols = grid.cols;
  const startIdx = start.row * cols + start.col;
  const goalIdx = goal.row * cols + goal.col;
  const heur = (col, row) => Math.hypot(col - goal.col, row - goal.row);

  const came = new Map();
  const g = new Map([[startIdx, 0]]);
  const f = new Map([[startIdx, heur(start.col, start.row)]]);
  const open = [startIdx];
  const inOpen = new Set([startIdx]);

  while (open.length) {
    // Extract the open node with the smallest f (linear scan — paths here are short).
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      if ((f.get(open[i]) ?? Infinity) < (f.get(open[bi]) ?? Infinity)) bi = i;
    }
    const current = open[bi];
    if (current === goalIdx) return reconstruct(grid, came, current);
    open.splice(bi, 1);
    inOpen.delete(current);

    const ccol = current % cols;
    const crow = (current - ccol) / cols;
    for (const [dc, dr, cost] of NEIGHBORS) {
      const ncol = ccol + dc;
      const nrow = crow + dr;
      if (!walkable(grid, ncol, nrow)) continue;
      // No corner cutting: a diagonal needs both shared orthogonal cells open.
      if (dc !== 0 && dr !== 0 && (!walkable(grid, ccol + dc, crow) || !walkable(grid, ccol, crow + dr))) {
        continue;
      }
      const ni = nrow * cols + ncol;
      const tentative = (g.get(current) ?? Infinity) + cost;
      if (tentative < (g.get(ni) ?? Infinity)) {
        came.set(ni, current);
        g.set(ni, tentative);
        f.set(ni, tentative + heur(ncol, nrow));
        if (!inOpen.has(ni)) {
          open.push(ni);
          inOpen.add(ni);
        }
      }
    }
  }
  return null; // exhausted the open set without reaching the goal
}

function reconstruct(grid, came, current) {
  const cols = grid.cols;
  const cells = [];
  let c = current;
  while (came.has(c)) {
    const col = c % cols;
    const row = (c - col) / cols;
    cells.push(cellCenter(grid, col, row));
    c = came.get(c);
  }
  cells.reverse(); // start → goal, excluding the start cell (it has no `came` entry)
  return cells;
}

// Built once for the live settings. Static obstacles (market props, garage props)
// are baked in here; the only dynamic obstacle is the room's fence wall, folded in
// by rebuildGrid whenever a pit is unlocked (see below).
export const grid = buildGrid(settings);

/**
 * Re-block the grid in place with the current dynamic obstacles (`extraBoxes`, the
 * moved fence wall). Keeps the SAME grid object + dimensions (only its occupancy
 * changes), so every module that imported `grid` keeps routing against the live
 * walls. Called from upgrades.buyExpandRoom the moment a room unlocks.
 */
export function rebuildGrid(extraBoxes = []) {
  grid.blocked = buildGrid(settings, extraBoxes).blocked;
}
