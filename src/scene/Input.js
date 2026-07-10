import settings from '../config/settings.js';

/**
 * Input — on-screen virtual joystick with a DYNAMIC, touch-anywhere anchor.
 *
 * Self-contained DOM (inline styles, no external CSS). Works with touch and
 * mouse via Pointer Events. The stick is hidden until the player presses inside
 * the input zone (the game canvas), then springs up centred on that press point
 * and stays anchored there while dragging; it hides again on release, so the
 * next press re-anchors it wherever the player touches. Exposes `.value` as a
 * screen-space vector:
 *   x: right positive, y: UP positive, magnitude 0..1 (0 inside the deadzone).
 * The control layer maps this to world space; Input stays render-only.
 */
export class Input {
  constructor() {
    this.value = { x: 0, y: 0 };
    this.radius = settings.joystick.radius;

    this._active = false;
    this._pointerId = null;
    this._center = { x: 0, y: 0 };

    this._keys = { up: false, down: false, left: false, right: false };

    this.#buildDom();
    this.#bind();
  }

  #buildDom() {
    const base = document.createElement('div');
    Object.assign(base.style, {
      position: 'fixed',
      // Placed dynamically (left/top) on each press so its centre lands on the
      // touch point; hidden until then. It's purely visual — the press itself is
      // captured on the canvas zone, so the ring never intercepts pointer events.
      left: '0px',
      top: '0px',
      display: 'none',
      pointerEvents: 'none',
      width: `${this.radius * 2}px`,
      height: `${this.radius * 2}px`,
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.10)',
      border: '2px solid rgba(255,255,255,0.25)',
      touchAction: 'none',
      zIndex: '10',
    });

    const thumb = document.createElement('div');
    Object.assign(thumb.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: `${this.radius}px`,
      height: `${this.radius}px`,
      marginLeft: `${-this.radius / 2}px`,
      marginTop: `${-this.radius / 2}px`,
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.35)',
      pointerEvents: 'none',
    });

    base.appendChild(thumb);
    document.body.appendChild(base);
    this.base = base;
    this.thumb = thumb;
  }

  #bind() {
    // Listen on the window (not the ring) so a press ANYWHERE in the input zone
    // can spawn the stick, and a drag can range past it. Move/release are global
    // so the drag keeps tracking even if the finger leaves the zone.
    window.addEventListener('pointerdown', (e) => this.#start(e));
    window.addEventListener('pointermove', (e) => this.#move(e));
    window.addEventListener('pointerup', (e) => this.#end(e));
    window.addEventListener('pointercancel', (e) => this.#end(e));

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (this.#setKey(e.code, true)) this.#recomputeFromKeys();
    });
    window.addEventListener('keyup', (e) => {
      if (this.#setKey(e.code, false)) this.#recomputeFromKeys();
    });
  }

  /** Maps a KeyboardEvent.code to a direction in this._keys; returns true if it matched one. */
  #setKey(code, down) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this._keys.up = down;
        return true;
      case 'KeyS':
      case 'ArrowDown':
        this._keys.down = down;
        return true;
      case 'KeyA':
      case 'ArrowLeft':
        this._keys.left = down;
        return true;
      case 'KeyD':
      case 'ArrowRight':
        this._keys.right = down;
        return true;
      default:
        return false;
    }
  }

  /** Combines the held movement keys into this.value, normalized to magnitude <= 1 (diagonals). */
  #recomputeFromKeys() {
    const { up, down, left, right } = this._keys;
    if (!up && !down && !left && !right) {
      if (!this._active) {
        this.value.x = 0;
        this.value.y = 0;
      }
      return;
    }

    let x = (right ? 1 : 0) - (left ? 1 : 0);
    let y = (up ? 1 : 0) - (down ? 1 : 0);
    const dist = Math.hypot(x, y);
    if (dist > 1) {
      x /= dist;
      y /= dist;
    }
    this.value.x = x;
    this.value.y = y;
  }

  /**
   * The joystick's usable input zone: a press on the game world (the canvas), not
   * on a DOM overlay (HUD, upgrade/break/truck menus, popups). Those sit above the
   * canvas as their own elements, so a press on them never targets the canvas and
   * never spawns the stick — leaving their taps to their own handlers.
   */
  #inZone(e) {
    return e.target instanceof HTMLCanvasElement;
  }

  #start(e) {
    if (this._active || !this.#inZone(e)) return;
    this._active = true;
    this._pointerId = e.pointerId;
    // Anchor the ring centred on the press point and reveal it.
    this._center.x = e.clientX;
    this._center.y = e.clientY;
    this.base.style.left = `${e.clientX - this.radius}px`;
    this.base.style.top = `${e.clientY - this.radius}px`;
    this.base.style.display = 'block';
    this.thumb.style.transform = 'translate(0px, 0px)';
    this.#move(e);
    e.preventDefault();
  }

  #move(e) {
    if (!this._active || e.pointerId !== this._pointerId) return;

    let dx = e.clientX - this._center.x;
    let dy = e.clientY - this._center.y;
    const dist = Math.hypot(dx, dy);
    if (dist > this.radius) {
      dx = (dx / dist) * this.radius;
      dy = (dy / dist) * this.radius;
    }
    this.thumb.style.transform = `translate(${dx}px, ${dy}px)`;

    let nx = dx / this.radius;
    let ny = dy / this.radius;
    if (Math.hypot(nx, ny) < settings.joystick.deadzone) {
      nx = 0;
      ny = 0;
    }
    this.value.x = nx;
    this.value.y = -ny; // screen y is down; invert so up = positive
  }

  #end(e) {
    if (e.pointerId !== this._pointerId) return;
    this._active = false;
    this._pointerId = null;
    this.value.x = 0;
    this.value.y = 0;
    this.thumb.style.transform = 'translate(0px, 0px)';
    this.base.style.display = 'none'; // vanish until the next press re-anchors it
  }
}
