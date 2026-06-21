import { formatMoney } from '../core/format.js';

/**
 * Hud.js — minimal DOM overlay. For this slice: a large live cash counter,
 * plus a small badge under it counting down an active rewarded-ad rep boost.
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

    const badge = document.createElement('div');
    Object.assign(badge.style, {
      position: 'fixed',
      top: '88px',
      left: '50%',
      transform: 'translateX(-50%)',
      font: '800 15px Arial, sans-serif',
      color: '#ffd23f',
      textShadow: '0 2px 0 #3a2a00, 0 0 8px rgba(0,0,0,0.5)',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '15',
      display: 'none',
    });
    document.body.appendChild(badge);
    this.badge = badge;

    this.update(0, 0);
  }

  update(cash, repBoostRemaining = 0) {
    if (cash !== this._cash) {
      this._cash = cash;
      this.el.textContent = `$${formatMoney(cash)}`;
    }

    if (repBoostRemaining > 0) {
      const s = Math.max(0, Math.ceil(repBoostRemaining));
      const m = Math.floor(s / 60);
      const r = s % 60;
      this.badge.textContent = `AD BOOST ${m}:${String(r).padStart(2, '0')}`;
      this.badge.style.display = 'block';
    } else {
      this.badge.style.display = 'none';
    }
  }
}
