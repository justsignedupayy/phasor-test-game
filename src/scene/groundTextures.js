import * as THREE from 'three';
import settings from '../config/settings.js';

const SIZE = 256;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

const hexToRgb = (hex) => ({
  r: ((hex >> 16) & 255) / 255,
  g: ((hex >> 8) & 255) / 255,
  b: (hex & 255) / 255,
});
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function makeNoise(rand, period) {
  const lattice = new Float32Array(period * period);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const fade = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * period;
    const y = v * period;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = fade(x - xi);
    const ty = fade(y - yi);
    const x0 = xi % period;
    const y0 = yi % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = lattice[y0 * period + x0];
    const b = lattice[y0 * period + x1];
    const c = lattice[y1 * period + x0];
    const d = lattice[y1 * period + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

function makeFbm(rand, periods) {
  const octaves = periods.map((p) => makeNoise(rand, p));
  return (u, v) => {
    let sum = 0;
    for (const n of octaves) sum += n(u, v);
    return sum / octaves.length;
  };
}

function drawCanvas(shade) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const data = img.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const [r, g, b] = shade(x / SIZE, y / SIZE);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function drawGrassCanvases() {
  const rand = mulberry32(0x517cc1b7);
  const mottle = makeFbm(rand, [5, 11, 23]);
  const dirt = makeNoise(rand, 4);
  const warm = makeNoise(rand, 7);
  const tint = hexToRgb(settings.world.surfaceTexture.dirtTint);

  const dirtMask = (u, v) => smoothstep(0.6, 0.85, dirt(u, v));
  const tone = (u, v, val, dirtAmt) => {
    const t = (warm(u, v) - 0.5) * 0.13; // +t = dry/yellow, -t = deep green
    let r = val * (1 + t);
    let g = val * (1 + t * 0.25);
    let b = val * (1 - t * 0.8);
    r *= 1 + (tint.r - 1) * dirtAmt;
    g *= 1 + (tint.g - 1) * dirtAmt;
    b *= 1 + (tint.b - 1) * dirtAmt;
    return [255 * clamp01(r), 255 * clamp01(g), 255 * clamp01(b)];
  };

  const colorCanvas = drawCanvas((u, v) => {
    const d = dirtMask(u, v);
    let val = 0.66 + (mottle(u, v) - 0.5) * 0.12 + (rand() - 0.5) * 0.1;
    val += d * 0.16; // bare dirt reads lighter than the shadowed turf base
    return tone(u, v, clamp01(val), 0.45 + 0.55 * d);
  });
  const bumpCanvas = drawCanvas((u, v) => {
    const c = 255 * clamp01(0.28 + (rand() - 0.5) * 0.16 + dirtMask(u, v) * 0.1);
    return [c, c, c]; // low soil bed, grainy so bare patches keep tooth
  });

  const cctx = colorCanvas.getContext('2d');
  const bctx = bumpCanvas.getContext('2d');
  cctx.lineCap = 'round';
  bctx.lineCap = 'round';
  const BLADES = 15000;
  const margin = 14; // > max blade length + tilt: within this of an edge, re-draw wrapped
  for (let i = 0; i < BLADES; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const u = x / SIZE;
    const v = y / SIZE;
    const d = dirtMask(u, v);
    if (rand() < d * 0.92) continue; // bare patches keep only stray blades
    const val = clamp01(0.92 + (mottle(u, v) - 0.5) * 0.16 + (rand() - 0.5) * 0.22);
    const [r, g, b] = tone(u, v, val, 0.12 * d);
    const len = 4.5 + rand() * 4.5;
    const tilt = (rand() - 0.5) * 3.2;
    const bumpVal = Math.round(255 * clamp01(0.45 + val * 0.42 + (rand() - 0.5) * 0.12));
    cctx.strokeStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
    bctx.strokeStyle = `rgb(${bumpVal},${bumpVal},${bumpVal})`;
    cctx.lineWidth = bctx.lineWidth = 1 + rand() * 0.5;
    const xs = [x];
    if (x < margin) xs.push(x + SIZE);
    else if (x > SIZE - margin) xs.push(x - SIZE);
    const ys = [y];
    if (y < margin) ys.push(y + SIZE);
    else if (y > SIZE - margin) ys.push(y - SIZE);
    for (const xx of xs) {
      for (const yy of ys) {
        for (const ctx of [cctx, bctx]) {
          ctx.beginPath();
          ctx.moveTo(xx, yy);
          ctx.lineTo(xx + tilt, yy - len); // short stroke, tip upward
          ctx.stroke();
        }
      }
    }
  }
  return { color: colorCanvas, bump: bumpCanvas };
}

function drawAsphaltCanvas() {
  const rand = mulberry32(0x2545f491);
  const mottle = makeFbm(rand, [5, 13, 29]);
  const wear = makeNoise(rand, 4);
  const drift = makeNoise(rand, 9);
  const base = hexToRgb(settings.colors.road);
  return drawCanvas((u, v) => {
    let val = 1 + (mottle(u, v) - 0.5) * 0.36;
    val *= 1 + 0.14 * smoothstep(0.58, 0.8, wear(u, v)); // worn/faded patches
    val += (rand() - 0.5) * 0.15; // aggregate grain
    const glint = rand();
    if (glint < 0.004) val *= 1.6; // bright aggregate glints
    else if (glint > 0.996) val *= 0.55; // dark pits
    const t = (drift(u, v) - 0.5) * 0.06;
    return [
      255 * clamp01(base.r * val * (1 + t)),
      255 * clamp01(base.g * val),
      255 * clamp01(base.b * val * (1 - t)),
    ];
  });
}

function drawConcreteCanvas() {
  const rand = mulberry32(0x85ebca6b);
  const mottle = makeFbm(rand, [4, 9, 19]);
  const stains = makeNoise(rand, 3);
  return drawCanvas((u, v) => {
    let val = 0.96 + (mottle(u, v) - 0.5) * 0.09;
    val += (rand() - 0.5) * 0.04; // grain
    val *= 1 - 0.06 * smoothstep(0.65, 0.88, stains(u, v)); // faint stains
    const c = 255 * clamp01(val);
    return [c, c, c];
  });
}

const BRICK_COLS = 4; // bricks per course in one texture tile
const BRICK_ROWS = 8; // courses per tile — EVEN, so the half-offset bond wraps vertically

function addGrain(ctx, rand, amp) {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() - 0.5) * amp;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function drawBrickCanvases() {
  const S = settings.world.surfaceTexture;
  const rand = mulberry32(0x27220a95);
  const brick = hexToRgb(S.brickColor);
  const mortar = hexToRgb(S.mortarColor);
  const cw = SIZE / BRICK_COLS; // brick cell size in px (incl. its mortar joint)
  const ch = SIZE / BRICK_ROWS;
  const joint = Math.max(2, Math.round(SIZE / 90)); // mortar joint thickness in px

  const canvasFilled = (style) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = style;
    ctx.fillRect(0, 0, SIZE, SIZE);
    return [canvas, ctx];
  };
  const rgb = (r, g, b) =>
    `rgb(${Math.round(255 * clamp01(r))},${Math.round(255 * clamp01(g))},${Math.round(255 * clamp01(b))})`;
  const [colorCanvas, cctx] = canvasFilled(rgb(mortar.r, mortar.g, mortar.b));
  const [bumpCanvas, bctx] = canvasFilled('rgb(60,60,60)'); // recessed mortar bed

  for (let row = 0; row < BRICK_ROWS; row++) {
    const shift = row % 2 ? cw / 2 : 0;
    for (let col = 0; col < BRICK_COLS; col++) {
      const x = col * cw + shift;
      const y = row * ch;
      const shade = 0.84 + rand() * 0.28; // per-brick light/dark jitter
      const t = (rand() - 0.5) * 0.12; // per-brick warm/cool tint
      const fill = rgb(brick.r * shade * (1 + t), brick.g * shade, brick.b * shade * (1 - t));
      const height = Math.round(140 + rand() * 70); // per-brick bump face height
      const draw = (bx) => {
        cctx.fillStyle = fill;
        cctx.fillRect(bx + joint / 2, y + joint / 2, cw - joint, ch - joint);
        bctx.fillStyle = `rgb(${height},${height},${height})`;
        bctx.fillRect(bx + joint / 2, y + joint / 2, cw - joint, ch - joint);
      };
      draw(x);
      if (x + cw > SIZE) draw(x - SIZE); // wrap the bond's edge-crossing brick
    }
  }
  addGrain(cctx, rand, 14);
  addGrain(bctx, rand, 26);
  return { color: colorCanvas, bump: bumpCanvas };
}

function brickTile() {
  const S = settings.world.surfaceTexture;
  return { w: S.brickWidth * BRICK_COLS, h: S.brickHeight * BRICK_ROWS };
}

function drawBumpCanvas(seed, periods, reliefAmp, grainAmp) {
  const rand = mulberry32(seed);
  const relief = makeFbm(rand, periods);
  return drawCanvas((u, v) => {
    const val = 0.5 + (relief(u, v) - 0.5) * reliefAmp + (rand() - 0.5) * grainAmp;
    const c = 255 * clamp01(val);
    return [c, c, c];
  });
}

let cache = null;

function getTextures() {
  if (cache) return cache;
  const tex = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const brick = drawBrickCanvases();
  const grass = drawGrassCanvases();
  cache = {
    grassMap: tex(grass.color, true),
    grassBump: tex(grass.bump, false),
    asphaltMap: tex(drawAsphaltCanvas(), true),
    asphaltBump: tex(drawBumpCanvas(0x27d4eb2f, [13, 29, 61], 0.45, 0.55), false),
    concreteMap: tex(drawConcreteCanvas(), true),
    concreteBump: tex(drawBumpCanvas(0x165667b1, [9, 19, 41], 0.5, 0.25), false),
    brickMap: tex(brick.color, true),
    brickBump: tex(brick.bump, false),
  };
  return cache;
}

function repeated(texture, repeatX, repeatY) {
  const t = texture.clone();
  t.needsUpdate = true;
  t.repeat.set(repeatX, repeatY);
  return t;
}

export function makeGrassMaterial(worldW, worldD) {
  const S = settings.world.surfaceTexture;
  const t = getTextures();
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: repeated(t.grassMap, worldW / S.grassTile, worldD / S.grassTile),
    bumpMap: repeated(t.grassBump, worldW / S.grassTile, worldD / S.grassTile),
    bumpScale: S.grassBumpScale,
  });
}

export function makeAsphaltMaterial(worldW, worldD) {
  const S = settings.world.surfaceTexture;
  const t = getTextures();
  return new THREE.MeshStandardMaterial({
    map: repeated(t.asphaltMap, worldW / S.roadTile, worldD / S.roadTile),
    bumpMap: repeated(t.asphaltBump, worldW / S.roadTile, worldD / S.roadTile),
    bumpScale: S.roadBumpScale,
  });
}

export function makeFloorMaterial(color, worldW, worldD) {
  const S = settings.world.surfaceTexture;
  const t = getTextures();
  return new THREE.MeshStandardMaterial({
    color,
    map: repeated(t.concreteMap, worldW / S.floorTile, worldD / S.floorTile),
    bumpMap: repeated(t.concreteBump, worldW / S.floorTile, worldD / S.floorTile),
    bumpScale: S.floorBumpScale,
  });
}

function brickFaceMaterial(repeatX, repeatY) {
  const S = settings.world.surfaceTexture;
  const t = getTextures();
  return new THREE.MeshStandardMaterial({
    flatShading: true,
    map: repeated(t.brickMap, repeatX, repeatY),
    bumpMap: repeated(t.brickBump, repeatX, repeatY),
    bumpScale: S.brickBumpScale,
  });
}

export function makeBrickWallMaterials(runW, worldH, depth, runAxis) {
  const tile = brickTile();
  const side = brickFaceMaterial(runW / tile.w, worldH / tile.h);
  const end = brickFaceMaterial(depth / tile.w, worldH / tile.h);
  const top =
    runAxis === 'x'
      ? brickFaceMaterial(runW / tile.w, depth / tile.h)
      : brickFaceMaterial(depth / tile.w, runW / tile.h);
  const mats =
    runAxis === 'x' ? [end, end, top, top, side, side] : [side, side, top, top, end, end];
  mats.side = side;
  mats.top = top;
  mats.runAxis = runAxis;
  return mats;
}

export function fitBrickSpan(mats, x0, x1) {
  const tile = brickTile();
  const w = Math.max(0.001, x1 - x0);
  const fitU = (m, r, o) => {
    m.map.repeat.x = r;
    m.map.offset.x = o; // RepeatWrapping handles the fractional wrap
    m.bumpMap.repeat.x = r;
    m.bumpMap.offset.x = o;
  };
  fitU(mats.side, w / tile.w, x0 / tile.w);
  if (mats.runAxis === 'x') {
    fitU(mats.top, w / tile.w, x0 / tile.w);
  } else {
    for (const m of [mats.top.map, mats.top.bumpMap]) {
      m.repeat.y = w / tile.h;
      m.offset.y = x0 / tile.h;
    }
  }
}
