import { formatMoney } from '../core/format.js';

/**
 * Hud.js — minimal DOM overlay. For this slice: a large live cash counter.
 */
export class Hud {
  constructor(state) {
    this.state = state;
    // Top-center column holding the cash counter. A flex column (rather than a
    // fixed element with a hardcoded `top`) keeps it centred as the cash font
    // scales with viewport width.
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

    document.body.appendChild(wrap);
    this.wrap = wrap;

    this.#buildDebugButtons();

    this.update(0);
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

  update(cash) {
    if (cash !== this._cash) {
      this._cash = cash;
      this.el.textContent = `$${formatMoney(cash)}`;
    }
  }
}
