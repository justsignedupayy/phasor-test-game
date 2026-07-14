import { formatMoney } from '../core/format.js';
import settings from '../config/settings.js';
import { wipeSave } from '../platform/storage.js';
import { assetUrl } from '../platform/assetUrl.js';

export class Hud {
  constructor(state) {
    this.state = state;
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'fixed',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '4px',
      maxWidth: '100vw',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '18',
    });

    const el = document.createElement('div');
    Object.assign(el.style, {
      font: `800 clamp(28px, 8vw, 56px) ${settings.ui.fontStack}`,
      color: '#3ad06a',
      textShadow: '0 3px 0 #06310f, 0 0 14px rgba(0,0,0,0.5)',
      whiteSpace: 'nowrap',
    });
    wrap.appendChild(el);
    this.el = el;
    this._cash = null;

    this._offlineRemaining = 0;
    this._offlineTotal = 0;

    document.body.appendChild(wrap);
    this.wrap = wrap;

    this.#placeCash();
    window.addEventListener('resize', () => this.#placeCash());

    this.#buildDebugButtons();

    this.update(0);
  }

  #placeCash() {
    const drop = window.innerWidth < settings.ui.narrowBreakpoint ? settings.ui.narrowCashDrop : 0;
    this.wrap.style.top = `calc(env(safe-area-inset-top, 0px) + ${14 + drop}px)`;
    if (this.debugRow) {
      this.debugRow.style.top = `calc(env(safe-area-inset-top, 0px) + ${68 + drop}px)`;
    }
  }

  startOfflineDrain(amount) {
    this._offlineRemaining = amount;
    this._offlineTotal = amount;
    this.#showOfflinePopup(amount);
  }

  #showOfflinePopup(amount) {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      left: '50%',
      top: '32%',
      transform: 'translate(-50%, -50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
      padding: '16px 22px',
      background: 'rgba(18,22,28,0.92)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '12px',
      color: '#e7ecf2',
      fontFamily: settings.ui.fontStack,
      textAlign: 'center',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '20',
      opacity: '1',
      transition: `opacity ${settings.offline.popupFadeSeconds}s ease-out`,
    });

    const title = document.createElement('div');
    title.textContent = 'While you were away';
    Object.assign(title.style, { fontWeight: '700', fontSize: '15px', color: '#9fb0c0' });

    const value = document.createElement('div');
    value.innerHTML = `+${moneyIconHtml('0 0.05em 0 0.1em')}${formatMoney(amount)}`;
    Object.assign(value.style, {
      fontWeight: '800',
      fontSize: '26px',
      color: '#3ad06a',
      textShadow: '0 2px 0 #06310f',
      whiteSpace: 'nowrap',
    });

    panel.append(title, value);
    document.body.appendChild(panel);

    setTimeout(() => {
      panel.style.opacity = '0';
      setTimeout(() => panel.remove(), settings.offline.popupFadeSeconds * 1000);
    }, settings.offline.popupSeconds * 1000);
  }

  #buildDebugButtons() {
    if (!import.meta.env?.DEV) return;
    const row = document.createElement('div');
    Object.assign(row.style, {
      position: 'fixed',
      right: '14px',
      display: 'flex',
      gap: '8px',
      zIndex: '17',
    });

    const cashBtn = this.#debugButton('💵 QUICK CASH', '#27ae60');
    cashBtn.addEventListener('click', () => {
      this.state.cash += 5000;
    });
    this.quickCashButton = cashBtn;

    const resetBtn = this.#debugButton('RESET', '#c0392b');
    resetBtn.addEventListener('click', () => {
      wipeSave();
      location.reload();
    });
    this.resetButton = resetBtn;

    row.append(cashBtn, resetBtn);
    document.body.appendChild(row);
    this.debugRow = row;
    this.#placeCash(); // set the row's initial top (created after the first placement ran)
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
      fontFamily: settings.ui.fontStack,
      cursor: 'pointer',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
    });
    return btn;
  }

  update(cash, dt = 0) {
    if (this._offlineRemaining > 0) {
      const rate = this._offlineTotal / settings.offline.drainDuration; // $/sec
      const delta = Math.min(this._offlineRemaining, rate * dt);
      this._offlineRemaining -= delta;
      this.state.cash += delta;
      cash = this.state.cash;
    }

    if (cash !== this._cash) {
      this._cash = cash;
      this.el.innerHTML = `${moneyIconHtml('0 0.08em 0 0')}${formatMoney(cash)}`;
    }
  }
}

function moneyIconHtml(margin) {
  return `<img src="${assetUrl('assets/images/money.png')}" alt="$" style="height:1em;vertical-align:middle;margin:${margin};">`;
}
