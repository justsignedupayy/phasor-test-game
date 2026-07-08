import * as THREE from 'three';
import settings from '../config/settings.js';
import { breakThreshold } from '../core/breaks.js';

/**
 * BreakLabel — the "x/y" break-progress counter floating above a worker's head
 * (jobs completed since the last break / that worker type's breakThreshold),
 * shared by every break-taking worker: pit mechanics, pump attendants (both
 * via Mechanic.js) and the market worker. The same camera-facing canvas-sprite
 * as the customer request labels (see scene/MarketCustomer.js). Render-only:
 * it mirrors the worker's core break state (core/breaks.js) each frame and
 * redraws its canvas only when the count actually changes.
 *
 * Hidden while the worker is on its break; the counter is already back at 0
 * when the break ends (incrementJobCount zeroes it on tripping the break and
 * endBreak re-zeroes it), so the label reappears reading "0/y".
 */
export class BreakLabel {
  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    // depthTest: false + a high renderOrder — same reasoning as the customer
    // request labels: a floating nameplate on a character that moves every
    // frame intermittently loses to the floor/model in the depth buffer, so
    // it always draws on top like the rest of this game's labels.
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
    );
    this.sprite.scale.set(2, 0.5, 1);
    this.sprite.renderOrder = 999;
    this.canvas = canvas;
    this.tex = tex;
    this.text = null;
  }

  /** Mirror the worker's break state (null hides, e.g. while unhired). */
  update(breakState) {
    if (!breakState || breakState.onBreak) {
      this.sprite.visible = false;
      return;
    }
    this.sprite.visible = true;
    const text = `${breakState.jobCount}/${breakThreshold(breakState)}`;
    if (text === this.text) return;
    this.text = text;
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = settings.colors.label;
    ctx.font = '800 26px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.fillText(text, this.canvas.width / 2, this.canvas.height / 2 + 2);
    this.tex.needsUpdate = true;
  }

  /** Free the per-instance canvas texture (not covered by material dispose). */
  dispose() {
    this.tex.dispose();
  }
}
