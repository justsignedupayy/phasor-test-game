import * as THREE from 'three';
import settings from '../config/settings.js';
import { breakRemaining, breakThreshold } from '../core/breaks.js';

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

  ctx.fillStyle = colors.ledOffColor;
  for (let cy = 0; cy < 5; cy++) for (let cx = 0; cx < cols; cx++) dot(cx, cy);

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
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(D.width, D.height),
      new THREE.MeshBasicMaterial({ map: this.tex })
    );
    screen.position.z = 0.041; // just off the casing's front face
    this.group.add(screen);

    if (pole) {
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

export function formatMmSs(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function breakText(breakState, state) {
  if (breakState.onBreak) return formatMmSs(breakRemaining(breakState, state));
  return String(Math.max(0, breakThreshold(breakState, state) - breakState.jobCount));
}

export class BreakDisplays {
  constructor(sceneManager) {
    const W = settings.world;
    const B = settings.breaks;
    const D = B.display;
    this.group = new THREE.Group();

    this.pitDisplays = B.breakSpots.map(
      (s) => this.#add(new LedDisplay({ x: s.x, y: D.y, z: -W.halfZ + D.wallInset, rotationY: 0 }))
    );
    this.marketDisplay = this.#add(
      new LedDisplay({
        x: -W.halfX + D.wallInset,
        y: D.y,
        z: B.marketBreakSpot.z,
        rotationY: Math.PI / 2,
      })
    );
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

  #sync(display, breakState, state) {
    if (breakState) display.setText(breakText(breakState, state));
    else display.hide();
  }
}
