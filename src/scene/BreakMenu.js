import { breakRemaining, endBreak } from '../core/breaks.js';
import { showRewardedAd } from '../platform/ads.js';
import { saveGame } from '../platform/storage.js';
import settings from '../config/settings.js';

/**
 * BreakMenu — a small DOM panel (not a full-screen overlay) opened by tapping a
 * resting worker (see main.js + CarYard.raycastRestingWorker /
 * SupermarketView.raycastRestingWorker). Shows which worker is on break, a live
 * countdown, and a "Watch Ad to Wake Up" button. The ad is the ONLY way to end
 * a break early: on its success callback the worker stands up immediately
 * (endBreak resets the counter). Styled to match the Advertising panel.
 */
export class BreakMenu {
  constructor(state) {
    this.state = state;
    this.isOpen = false;
    this.break = null; // the break-state object currently shown (pit.break / worker.break)
    this.label = '';
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

    this.heading = document.createElement('div');
    Object.assign(this.heading.style, { fontWeight: '800', fontSize: '17px' });
    panel.appendChild(this.heading);

    this.statusLine = document.createElement('div');
    Object.assign(this.statusLine.style, { fontSize: '14px', color: '#9fb0c0' });
    panel.appendChild(this.statusLine);

    this.timerLine = document.createElement('div');
    Object.assign(this.timerLine.style, { fontSize: '22px', fontWeight: '800', color: '#ffd23f', minHeight: '26px' });
    panel.appendChild(this.timerLine);

    this.adBtn = document.createElement('button');
    Object.assign(this.adBtn.style, {
      padding: '10px 8px',
      borderRadius: '8px',
      border: 'none',
      fontWeight: '800',
      fontSize: '13px',
      cursor: 'pointer',
      background: '#3ad06a',
      color: '#06310f',
    });
    this.adBtn.textContent = 'Watch Ad to Wake Up';
    this.adBtn.addEventListener('click', () => this.#wakeUp());
    panel.appendChild(this.adBtn);

    document.body.appendChild(panel);
    this.panel = panel;
  }

  /** Open for a specific worker's break state (a pit.break / worker.break) + label. */
  open(breakState, label) {
    if (!breakState || !breakState.onBreak) return;
    this.break = breakState;
    this.label = label;
    this.isOpen = true;
    this.heading.textContent = label;
    this.panel.style.display = 'flex';
    this.#refresh();
  }

  close() {
    this.isOpen = false;
    this.break = null;
    this.panel.style.display = 'none';
  }

  #wakeUp() {
    const b = this.break;
    if (!b) return;
    showRewardedAd(
      () => {
        endBreak(b); // stands up immediately, counter reset to 0
        saveGame(this.state);
        this.close();
      },
      () => {} // ad failed/skipped — worker stays seated, panel stays open
    );
  }

  /** Called every frame from main.js; cheap no-op while closed. Auto-closes when
   * the break ends on its own (timer expiry) so a stale panel never lingers. */
  update() {
    if (!this.isOpen) return;
    if (!this.break || !this.break.onBreak) {
      this.close();
      return;
    }
    this.#refresh();
  }

  #refresh() {
    this.statusLine.textContent = 'On break';
    this.timerLine.textContent = mmss(breakRemaining(this.break, this.state));
  }
}

function mmss(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
