import { getReputationMenuModel, buyAdvertising, activateRepBoost } from '../core/reputation.js';
import { showRewardedAd } from '../platform/ads.js';
import { saveGame } from '../platform/storage.js';

/**
 * AdvertisingMenu — DOM overlay opened by tapping the garage computer (see
 * Computer.raycastTap + main.js). Shows current (and boosted) reputation as a
 * percentage, a permanent "Buy Advertising" upgrade, and a rewarded-ad button
 * for a temporary 2× boost. Hidden until open(); only refreshes while open.
 */
export class AdvertisingMenu {
  constructor(state) {
    this.state = state;
    this.isOpen = false;
    this.#build();
  }

  #build() {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      display: 'none',
      flexDirection: 'column',
      gap: '10px',
      width: '230px',
      padding: '18px',
      background: 'rgba(18,22,28,0.92)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '12px',
      color: '#e7ecf2',
      fontFamily: 'Arial, sans-serif',
      userSelect: 'none',
      zIndex: '18',
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      position: 'absolute',
      right: '10px',
      top: '10px',
      width: '26px',
      height: '26px',
      borderRadius: '6px',
      border: 'none',
      background: '#3a434f',
      color: '#e7ecf2',
      fontWeight: '800',
      cursor: 'pointer',
    });
    closeBtn.addEventListener('click', () => this.close());
    panel.appendChild(closeBtn);

    const heading = document.createElement('div');
    heading.textContent = 'Advertising';
    Object.assign(heading.style, { fontWeight: '800', fontSize: '17px' });
    panel.appendChild(heading);

    this.repLine = document.createElement('div');
    Object.assign(this.repLine.style, { fontSize: '14px', color: '#9fb0c0' });
    panel.appendChild(this.repLine);

    this.boostLine = document.createElement('div');
    Object.assign(this.boostLine.style, { fontSize: '13px', color: '#ffd23f', minHeight: '16px' });
    panel.appendChild(this.boostLine);

    this.buyBtn = makeButton();
    this.buyBtn.addEventListener('click', () => {
      if (buyAdvertising(this.state)) {
        this.#refresh();
        saveGame(this.state);
      }
    });
    panel.appendChild(this.buyBtn);

    this.adBtn = makeButton();
    this.adBtn.addEventListener('click', () => {
      if (this.state.repBoostRemaining > 0) return;
      showRewardedAd(
        () => {
          activateRepBoost(this.state);
          this.#refresh();
          saveGame(this.state);
        },
        () => this.#refresh()
      );
    });
    panel.appendChild(this.adBtn);

    document.body.appendChild(panel);
    this.panel = panel;
  }

  open() {
    this.isOpen = true;
    this.panel.style.display = 'flex';
    this.#refresh();
  }

  close() {
    this.isOpen = false;
    this.panel.style.display = 'none';
  }

  /** Called every frame from main.js; cheap no-op while closed. */
  update() {
    if (this.isOpen) this.#refresh();
  }

  #refresh() {
    const m = getReputationMenuModel(this.state);

    this.repLine.textContent = m.boostActive
      ? `Reputation: ${m.permanentPct}% (boosted to ${m.effectivePct}%)`
      : `Reputation: ${m.permanentPct}%`;
    this.boostLine.textContent = m.boostActive ? `Ad boost active — ${mmss(m.boostRemaining)}` : '';

    this.buyBtn.textContent = m.atCap ? 'Reputation MAXED' : `Buy Advertising (+1%) — ${m.adCostLabel}`;
    setDisabled(this.buyBtn, m.adDisabled);

    if (m.boostActive) {
      this.adBtn.textContent = `Ad active — ${mmss(m.boostRemaining)}`;
      setDisabled(this.adBtn, true);
    } else {
      this.adBtn.textContent = 'Watch Ad — 2× chance for 5:00';
      setDisabled(this.adBtn, false);
    }
  }
}

function makeButton() {
  const b = document.createElement('button');
  Object.assign(b.style, {
    padding: '10px 8px',
    borderRadius: '8px',
    border: 'none',
    fontWeight: '800',
    fontSize: '13px',
    cursor: 'pointer',
  });
  return b;
}

function setDisabled(btn, disabled) {
  btn.disabled = disabled;
  btn.style.opacity = disabled ? '0.45' : '1';
  btn.style.cursor = disabled ? 'default' : 'pointer';
  btn.style.background = disabled ? '#3a434f' : '#3ad06a';
  btn.style.color = disabled ? '#9fb0c0' : '#06310f';
}

function mmss(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
