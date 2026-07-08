import settings from '../config/settings.js';

/**
 * Input — on-screen virtual joystick, anchored bottom-center.
 *
 * Self-contained DOM (inline styles, no external CSS). Works with touch and
 * mouse via Pointer Events. Exposes `.value` as a screen-space vector:
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
      left: '50%',
      // Viewport-relative offset that scales with screen height, clamped to a
      // sensible minimum, plus the device safe-area inset (iPhone home
      // indicator). Keeps the stick reachable at the bottom in any orientation.
      bottom: 'calc(env(safe-area-inset-bottom, 0px) + max(7vh, 64px))',
      transform: 'translateX(-50%)',
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
    this.base.addEventListener('pointerdown', (e) => this.#start(e));
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

  #start(e) {
    this._active = true;
    this._pointerId = e.pointerId;
    const r = this.base.getBoundingClientRect();
    this._center.x = r.left + r.width / 2;
    this._center.y = r.top + r.height / 2;
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
  }
}
