import * as THREE from 'three';
import settings from '../config/settings.js';
import { breakRemaining, breakThreshold } from '../core/breaks.js';

/**
 * LedDisplay — a small wall-mounted LED panel: black panel, dot-matrix digits
 * (a hand-rolled 3×5 pixel font drawn to a per-panel CanvasTexture — same
 * procedural draw-once-then-redraw-on-change approach as the other canvas
 * elements, e.g. the customer request labels). The generic panel is exported for any
 * fixture that needs the look (the supermarket's truck-status panel reuses it,
 * green LEDs via its ledColor override); setText shows + redraws only when the
 * text actually changes, hide() blanks the slot.
 *
 * The break panels' content mirrors each worker's core break clock
 * (core/breaks.js), live:
 *   working   the jobs left before the next break ("12") —
 *             breakThreshold − jobCount
 *   on break  the time left until the break ends ("03:45", mm:ss) —
 *             breakRemaining()
 * Hidden while the slot has no worker.
 *
 * BreakDisplays is the manager: one panel per worker slot — each pit's
 * mechanic and the market worker get theirs on the wall they lean against
 * (front wall / left wall, near the top); each pump's attendant leans beside
 * its pump in the open where there IS no wall, so its panel stands on a small
 * pole at the same spot instead. All placement knobs: settings.breaks.display.
 */

// 3×5 dot-matrix glyphs (rows of '1' = lit). Digits, the colon (countdowns)
// and the slash ("x/y" stock readouts) — the only characters any display needs.
const GLYPHS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '011', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  ':': ['0', '1', '0', '1', '0'],
  '/': ['001', '001', '010', '100', '100'],
};

const CANVAS_W = 256;
const CANVAS_H = 80;
const CELL = 12; // px per LED cell — "05:00" is 17 cells wide (204px), the widest text

/** Redraw the panel canvas: unlit dot grid under the text block, lit dots on top. */
function drawLedText(canvas, text, colors) {
  const ctx = canvas.getContext('2d');
  ctx.shadowBlur = 0;
  ctx.fillStyle = colors.bgColor;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const chars = [...text].map((ch) => GLYPHS[ch]).filter(Boolean);
  const cols = chars.reduce((n, g) => n + g[0].length, 0) + (chars.length - 1); // 1 blank col between glyphs
  const x0 = (CANVAS_W - cols * CELL) / 2;
  const y0 = (CANVAS_H - 5 * CELL) / 2;

  const dot = (cx, cy) => ctx.fillRect(x0 + cx * CELL + 2, y0 + cy * CELL + 2, CELL - 4, CELL - 4);

  // Unlit grid over the whole text block, so it reads as an LED matrix.
  ctx.fillStyle = colors.ledOffColor;
  for (let cy = 0; cy < 5; cy++) for (let cx = 0; cx < cols; cx++) dot(cx, cy);

  // Lit pixels, with a soft glow.
  ctx.fillStyle = colors.ledColor;
  ctx.shadowColor = colors.ledColor;
  ctx.shadowBlur = 8;
  let cx0 = 0;
  for (const glyph of chars) {
    for (let cy = 0; cy < 5; cy++) {
      for (let gx = 0; gx < glyph[cy].length; gx++) {
        if (glyph[cy][gx] === '1') dot(cx0 + gx, cy);
      }
    }
    cx0 += glyph[0].length + 1;
  }
}

export class LedDisplay {
  /** Panel centred at (x, y, z), its face turned rotationY about +y (0 faces
   * +z). `pole` adds the ground stand for the wall-less pump spots.
   * ledColor/ledOffColor default to the break panels' red (settings.breaks
   * .display) — pass both to retint (e.g. the truck panel's green). */
  constructor({ x, y, z, rotationY, pole = false, ledColor, ledOffColor }) {
    const D = settings.breaks.display;
    this.colors = {
      ledColor: ledColor ?? D.ledColor,
      ledOffColor: ledOffColor ?? D.ledOffColor,
      bgColor: D.bgColor,
    };
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.group.rotation.y = rotationY;

    // Physical casing: a thin dark box the screen sits on, so the panel reads
    // as a mounted fixture instead of a floating decal.
    const casing = new THREE.Mesh(
      new THREE.BoxGeometry(D.width + 0.12, D.height + 0.12, 0.08),
      new THREE.MeshStandardMaterial({ color: D.frameColor, flatShading: true })
    );
    casing.castShadow = true;
    this.group.add(casing);

    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    this.canvas = canvas;
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.anisotropy = 4;
    // MeshBasicMaterial: unlit, so the LED face glows evenly regardless of the
    // scene lights — it's a light source, not a lit surface.
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(D.width, D.height),
      new THREE.MeshBasicMaterial({ map: this.tex })
    );
    screen.position.z = 0.041; // just off the casing's front face
    this.group.add(screen);

    if (pole) {
      // Stand from the ground up to the casing (pump spots have no wall).
      const stand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, y),
        new THREE.MeshStandardMaterial({ color: D.frameColor, flatShading: true })
      );
      stand.position.y = -y / 2;
      stand.castShadow = true;
      this.group.add(stand);
    }

    this.text = null;
    this.group.visible = false;
  }

  /** Show the panel with this text, redrawing only when it actually changes. */
  setText(text) {
    this.group.visible = true;
    if (text === this.text) return;
    this.text = text;
    drawLedText(this.canvas, text, this.colors);
    this.tex.needsUpdate = true;
  }

  hide() {
    this.group.visible = false;
  }
}

/** Seconds → "mm:ss", the shared countdown format of every LED panel. */
export function formatMmSs(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** One worker's break clock as panel text: mm:ss on break, jobs-to-break otherwise. */
function breakText(breakState, state) {
  if (breakState.onBreak) return formatMmSs(breakRemaining(breakState, state));
  return String(Math.max(0, breakThreshold(breakState) - breakState.jobCount));
}

/** All the panels: one per worker slot, updated from core state each frame. */
export class BreakDisplays {
  constructor(sceneManager) {
    const W = settings.world;
    const B = settings.breaks;
    const D = B.display;
    this.group = new THREE.Group();

    // Pit mechanics lean on the front wall (their spots sit just inside it) —
    // one panel per pit, high on that wall's inner face, facing into the room.
    this.pitDisplays = B.breakSpots.map(
      (s) => this.#add(new LedDisplay({ x: s.x, y: D.y, z: -W.halfZ + D.wallInset, rotationY: 0 }))
    );
    // The market worker leans on the left wall.
    this.marketDisplay = this.#add(
      new LedDisplay({
        x: -W.halfX + D.wallInset,
        y: D.y,
        z: B.marketBreakSpot.z,
        rotationY: Math.PI / 2,
      })
    );
    // Attendants lean beside their pump in the open — pole-mounted panels
    // just behind the spot, same facing as the leaning attendant (+z).
    this.pumpDisplays = B.pumpBreakSpots.map(
      (s) => this.#add(new LedDisplay({ x: s.x, y: D.poleY, z: s.z - D.pumpBack, rotationY: 0, pole: true }))
    );

    sceneManager.add(this.group);
  }

  #add(display) {
    this.group.add(display.group);
    return display;
  }

  update(state) {
    state.pits.forEach((pit, i) => this.#sync(this.pitDisplays[i], pit.hasMechanic ? pit.break : null, state));
    const worker = state.supermarket.worker;
    this.#sync(this.marketDisplay, worker ? worker.break : null, state);
    state.gasStation.pumps.forEach((pump, i) =>
      this.#sync(this.pumpDisplays[i], pump.hasAttendant ? pump.break : null, state)
    );
  }

  /** Mirror one worker's break clock onto its panel (null hides it — slot unhired). */
  #sync(display, breakState, state) {
    if (breakState) display.setText(breakText(breakState, state));
    else display.hide();
  }
}
