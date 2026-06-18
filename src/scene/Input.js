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

    this.#buildDom();
    this.#bind();
  }

  #buildDom() {
    const base = document.createElement('div');
    Object.assign(base.style, {
      position: 'fixed',
      left: '50%',
      bottom: '90px',
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
