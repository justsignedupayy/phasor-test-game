import * as THREE from 'three';
import settings from '../config/settings.js';

/**
 * groundTextures — procedural, seamlessly tileable CanvasTextures for the big
 * flat surfaces (the grass field, every road slab, the garage floor patches),
 * plus matching greyscale bump maps, so they read as textured ground instead
 * of solid-colour planes. Same draw-once-into-a-canvas approach as the poof /
 * smoke sprites, but written per-pixel from PERIODIC value noise: the noise
 * lattice wraps at the tile edge, so THREE.RepeatWrapping tiles with no seam.
 *
 * The canvases are drawn once (module-level cache, deterministic PRNG so the
 * world looks identical every run); the exported material factories clone the
 * cached textures per mesh so each slab sets its own repeat count from its
 * world size (texture.repeat is per-texture state — clones share the pixels).
 *
 * Colour strategy: the grass and floor maps are NEUTRAL variation maps centred
 * near white, multiplied by the existing settings colour (vertex colours for
 * the grass field, material.color for the floors) — so the settings.colors
 * tunables keep controlling the palette. The asphalt map bakes colors.road in
 * directly (its worn/tint variation wants to brighten past the base grey).
 * Knobs live in settings.world.surfaceTexture.
 */

const SIZE = 256;

/** mulberry32 — tiny deterministic PRNG so the ground looks identical every run. */
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

/** Hex int → {r,g,b} in 0-1, RAW sRGB channels. Deliberately not THREE.Color:
 * that converts to linear working space, and these values are written into
 * SRGB-tagged canvases — the shader does the linear conversion, so converting
 * here too would double-darken everything. */
const hexToRgb = (hex) => ({
  r: ((hex >> 16) & 255) / 255,
  g: ((hex >> 8) & 255) / 255,
  b: (hex & 255) / 255,
});
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Periodic value noise: a `period`×`period` random lattice sampled with
 * smoothed bilinear interpolation, indices wrapped — so noise(0,v) == noise(1,v)
 * and the drawn tile repeats seamlessly. u/v in [0,1).
 */
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

/** A few octaves of periodic noise summed to equal-weight fBm, output in [0,1].
 * Co-prime periods keep the octave lattices from lining up into a visible grid. */
function makeFbm(rand, periods) {
  const octaves = periods.map((p) => makeNoise(rand, p));
  return (u, v) => {
    let sum = 0;
    for (const n of octaves) sum += n(u, v);
    return sum / octaves.length;
  };
}

/** Fill a SIZE×SIZE canvas per-pixel; `shade(u, v)` returns [r, g, b] in 0-255. */
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

/**
 * Grass colour + bump canvases, drawn together so the bump relief lines up
 * with the painted blades. Two passes:
 *   1. a per-pixel SOIL bed — darker than the blades (reads as the shadowed
 *      base of the turf), always slightly earthy, and pulled fully toward the
 *      dirtTint (and a touch brighter) inside the low-frequency bare patches;
 *   2. thousands of short, tilted BLADE strokes on top — each stroke's tone
 *      comes from the shared palette (the natural-tone fix: warm patches lean
 *      dry straw-yellow, cool ones deeper green) plus per-blade jitter. Bare
 *      dirt patches keep only stray blades, so the soil shows through there.
 * Still a multiplier map over the field's green vertex colours. Strokes near
 * a tile edge are re-drawn one tile over, so RepeatWrapping stays seamless.
 */
function drawGrassCanvases() {
  const rand = mulberry32(0x517cc1b7);
  const mottle = makeFbm(rand, [5, 11, 23]);
  const dirt = makeNoise(rand, 4);
  const warm = makeNoise(rand, 7);
  const tint = hexToRgb(settings.world.surfaceTexture.dirtTint);

  const dirtMask = (u, v) => smoothstep(0.6, 0.85, dirt(u, v));
  // Shared palette (the earlier tone fix, kept): a multiplier around the
  // field's green, hue-drifted warm/cool, blended toward dirtTint by dirtAmt.
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

  // Pass 1: the soil bed.
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

  // Pass 2: the blades.
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

/**
 * Asphalt map (bakes colors.road): broad mottling, lighter worn/faded patches,
 * strong per-pixel aggregate grain, sparse bright glints and dark pits, and a
 * faint warm/cool drift on the r/b channels so big slabs aren't uniformly grey.
 */
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

/**
 * Concrete variation map (neutral, multiplies the floor patches' colours):
 * subtle mottling, fine grain, and faint darker stains — enough that the big
 * garage floor doesn't read as one flat sheet, without fighting the paint
 * markings drawn on top of it.
 */
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

/** Per-pixel ±amp noise over a whole canvas (Uint8ClampedArray clamps for us).
 * Uncorrelated grain needs no wrap handling, so it can't break the tile seam. */
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

/**
 * Brick colour + bump canvases, drawn together so each brick's shade jitter
 * and bump height come from the same rolls. Running bond: odd courses shift
 * half a brick, and any brick crossing the tile's right edge is drawn again
 * one tile-width left — with the even course count, the pattern wraps
 * seamlessly both ways. Colour map bakes brickColor/mortarColor (like the
 * asphalt map bakes colors.road); bump map recesses the mortar joints and
 * gives each brick face its own height so the wall catches raking light.
 */
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

/** World size of one brick-texture tile (BRICK_COLS bricks × BRICK_ROWS courses). */
function brickTile() {
  const S = settings.world.surfaceTexture;
  return { w: S.brickWidth * BRICK_COLS, h: S.brickHeight * BRICK_ROWS };
}

/** Greyscale bump canvas: fBm relief + per-pixel grain around mid-grey. */
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

/** Clone a cached texture (shares pixels) and set its repeat count per axis. */
function repeated(texture, repeatX, repeatY) {
  const t = texture.clone();
  t.needsUpdate = true;
  t.repeat.set(repeatX, repeatY);
  return t;
}

/** Grass-field material: vertex colours carry the green, the map adds detail. */
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

/** Road-slab material: asphalt colour is baked into the map (colors.road). */
export function makeAsphaltMaterial(worldW, worldD) {
  const S = settings.world.surfaceTexture;
  const t = getTextures();
  return new THREE.MeshStandardMaterial({
    map: repeated(t.asphaltMap, worldW / S.roadTile, worldD / S.roadTile),
    bumpMap: repeated(t.asphaltBump, worldW / S.roadTile, worldD / S.roadTile),
    bumpScale: S.roadBumpScale,
  });
}

/** Floor-patch material: `color` (a settings.colors int) times the neutral
 * concrete grain map, so the existing floor palette stays the tunable. */
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

/** One brick MeshStandardMaterial with the given repeat counts (texture
 * clones share the cached canvases). flatShading keeps the low-poly look. */
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

/**
 * Wall materials: a 6-slot array for a BoxGeometry wall with the brick tiling
 * fit per face — the long side faces along the run, the end caps across the
 * depth, and the top face over run × depth — so no face shows stretched
 * bricks (one material can't do this: the three face shapes need three
 * different repeats). BoxGeometry face order is [+x, -x, +y, -y, +z, -z];
 * runAxis is the world axis the wall runs along ('x' for the front/back
 * walls, 'z' for the left/right walls and corridors). The bottom face reuses
 * the top material — it sits on the floor and is never seen.
 *
 * A box's top-face UVs always run u = x, v = z, so the top's courses lie
 * along z on x-run walls (stretcher bond seen from above) and along x on
 * z-run walls (header courses across the thickness) — different orientations,
 * but every brick keeps its true world size.
 *
 * The returned array carries .side/.top/.runAxis so fitBrickSpan can refit
 * the run-dependent faces when a pooled wall segment is rescaled.
 */
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

/**
 * Refit a brick wall's run-dependent faces (side + top — the end caps never
 * rescale) to a segment that was rescaled this frame: [x0, x1] is the world
 * span along the wall's own run axis. The repeat keeps bricks at their true
 * world size while the mesh stretches; the world-anchored offset pins the
 * bond pattern in place, so segments align across door gaps and the bricks
 * don't swim as the right wall slides.
 */
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
    // A z-run wall's top face has its run along v (u is the thickness).
    for (const m of [mats.top.map, mats.top.bumpMap]) {
      m.repeat.y = w / tile.h;
      m.offset.y = x0 / tile.h;
    }
  }
}
