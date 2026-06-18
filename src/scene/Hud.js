/**
 * Hud.js — minimal DOM overlay. For this slice: a large live cash counter.
 */
export class Hud {
  constructor() {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      top: '22px',
      left: '50%',
      transform: 'translateX(-50%)',
      font: '800 56px Arial, sans-serif',
      color: '#3ad06a',
      textShadow: '0 3px 0 #06310f, 0 0 14px rgba(0,0,0,0.5)',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '15',
    });
    document.body.appendChild(el);
    this.el = el;
    this._cash = null;
    this.update(0);
  }

  update(cash) {
    if (cash !== this._cash) {
      this._cash = cash;
      this.el.textContent = `$${cash}`;
    }
  }
}
