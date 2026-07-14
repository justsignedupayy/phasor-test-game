import { truckDeliveryTime, orderTruck, callTruckEarly } from '../core/supermarket.js';
import { showRewardedAd } from '../platform/ads.js';
import { saveGame } from '../platform/storage.js';
import settings from '../config/settings.js';

export class TruckMenu {
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
      fontFamily: settings.ui.fontStack,
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
    heading.textContent = 'Restock Box Empty';
    Object.assign(heading.style, { fontWeight: '800', fontSize: '17px' });
    panel.appendChild(heading);

    this.statusLine = document.createElement('div');
    Object.assign(this.statusLine.style, { fontSize: '14px', color: '#9fb0c0' });
    this.statusLine.textContent = 'Waiting for truck…';
    panel.appendChild(this.statusLine);

    this.timerLine = document.createElement('div');
    Object.assign(this.timerLine.style, { fontSize: '22px', fontWeight: '800', color: '#ffd23f', minHeight: '26px' });
    panel.appendChild(this.timerLine);

    const button = (text, background, color, onClick) => {
      const b = document.createElement('button');
      Object.assign(b.style, {
        padding: '10px 8px',
        borderRadius: '8px',
        border: 'none',
        fontWeight: '800',
        fontSize: '13px',
        cursor: 'pointer',
        background,
        color,
      });
      b.textContent = text;
      b.addEventListener('click', onClick);
      panel.appendChild(b);
      return b;
    };

    this.orderBtn = button('Order Truck', '#ffd23f', '#1a1400', () => this.#order());
    this.adBtn = button('Call Truck Early (Watch Ad)', '#3ad06a', '#06310f', () => this.#callEarly());

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

  #order() {
    if (orderTruck(this.state)) {
      saveGame(this.state);
      this.#refresh(); // flip straight to the countdown view
    }
  }

  #callEarly() {
    showRewardedAd(
      () => {
        callTruckEarly(this.state); // pending order dispatched on the next tick, box refills on arrival
        saveGame(this.state);
        this.close();
      },
      () => {} // ad failed/skipped — nothing changes, panel stays open
    );
  }

  update() {
    if (!this.isOpen) return;
    if (this.state.supermarket.restockBox.units > 0) {
      this.close();
      return;
    }
    this.#refresh();
  }

  #refresh() {
    const S = this.state.supermarket;
    if (S.truckArriving) {
      this.statusLine.textContent = 'Truck arriving…';
      this.timerLine.textContent = 'Now';
      this.orderBtn.style.display = 'none';
      this.adBtn.style.display = 'none';
      return;
    }
    if (S.truckOrdered) {
      this.statusLine.textContent = 'Order placed — truck on the way…';
      this.timerLine.textContent = mmss(truckDeliveryTime(this.state) - S.truckTimer);
      this.orderBtn.style.display = 'none';
      this.adBtn.style.display = 'block';
      return;
    }
    this.statusLine.textContent = 'No delivery ordered.';
    this.timerLine.textContent = '—';
    this.orderBtn.style.display = 'block';
    this.adBtn.style.display = 'none';
  }
}

function mmss(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
