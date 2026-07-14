import settings from '../config/settings.js';
import { buildObstacleList } from './collision.js';

const NPC_RADIUS = settings.player.radius;

function buildGrid(s, extraBoxes = []) {
  const W = s.world;
  const M = s.supermarket;
  const cellSize = s.pathfinding.cellSize;
  const minX = -W.halfX;
  const minZ = -W.halfZ;
  const cols = Math.ceil((W.halfX * 2) / cellSize);
  const rows = Math.ceil((W.halfZ * 2) / cellSize);
  const blocked = new Uint8Array(cols * rows);
  const r = NPC_RADIUS;

  const rects = buildObstacleList(null, s, { allPits: true, walls: extraBoxes });

  const g = W.gateHalf;
  const frontDoorXs = [M.deliveryDoorX];
  const backDoorXs = [M.marketX, M.marketExitX];
  const inGap = (xs, cx) => xs.some((dx) => Math.abs(cx - dx) <= g);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = minX + (col + 0.5) * cellSize;
      const cz = minZ + (row + 0.5) * cellSize;
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

export const grid = buildGrid(settings);

export function rebuildGrid(extraBoxes = []) {
  grid.blocked = buildGrid(settings, extraBoxes).blocked;
}
