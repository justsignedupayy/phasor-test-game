import { formatMoney } from '../core/format.js';

/**
 * Hud.js — minimal DOM overlay. For this slice: a large live cash counter,
 * plus a small badge under it counting down an active rewarded-ad rep boost.
 */
export class Hud {
  constructor(state) {
    this.state = state;
    // Top-center column: the cash counter with the boost badge flowing directly
    // beneath it. Stacking in a flex column (rather than two fixed elements with
    // hardcoded `top` values) keeps the badge correctly placed even as the cash
    // font scales with viewport width.
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'fixed',
      top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '4px',
      maxWidth: '100vw',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '15',
    });

    const el = document.createElement('div');
    Object.assign(el.style, {
      // Scales with viewport width so it never overruns the corner buttons on a
      // narrow portrait screen, capped at the original landscape size.
      font: '800 clamp(28px, 8vw, 56px) Arial, sans-serif',
      color: '#3ad06a',
      textShadow: '0 3px 0 #06310f, 0 0 14px rgba(0,0,0,0.5)',
      whiteSpace: 'nowrap',
    });
    wrap.appendChild(el);
    this.el = el;
    this._cash = null;

    const badge = document.createElement('div');
    Object.assign(badge.style, {
      font: '800 15px Arial, sans-serif',
      color: '#ffd23f',
      textShadow: '0 2px 0 #3a2a00, 0 0 8px rgba(0,0,0,0.5)',
      display: 'none',
    });
    wrap.appendChild(badge);
    this.badge = badge;

    document.body.appendChild(wrap);
    this.wrap = wrap;

    this.#buildDebugButtons();

    this.update(0, 0);
  }

  // Top-right debug row: Quick Cash (grant test money) next to Reset (wipe save).
  #buildDebugButtons() {
    const row = document.createElement('div');
    Object.assign(row.style, {
      position: 'fixed',
      right: '14px',
      top: '14px',
      display: 'flex',
      gap: '8px',
      zIndex: '17',
    });

    const cashBtn = this.#debugButton('💵 QUICK CASH', '#27ae60');
    cashBtn.addEventListener('click', () => {
      this.state.cash += 1000;
    });
    this.quickCashButton = cashBtn;

    const resetBtn = this.#debugButton('RESET', '#c0392b');
    resetBtn.addEventListener('click', () => {
      localStorage.clear();
      location.reload();
    });
    this.resetButton = resetBtn;

    row.append(cashBtn, resetBtn);
    document.body.appendChild(row);
  }

  #debugButton(text, background) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, {
      padding: '10px 14px',
      borderRadius: '10px',
      border: 'none',
      background,
      color: '#fff',
      fontWeight: '800',
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
    });
    return btn;
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
