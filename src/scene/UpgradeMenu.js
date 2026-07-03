import {
  getMenuModel,
  buyWorkerSpeed,
  buyFixingTime,
  buyAutoRestock,
  trainMarketWorker,
  buyBreakRoom,
  buyMarketBreakRoom,
  buyTruckFrequency,
  buyAttendantSpeed,
  buyGasBreakRoom,
} from '../core/upgrades.js';
import settings from '../config/settings.js';
import { getReputationMenuModel, buyAdvertising, activateRepBoost } from '../core/reputation.js';
import { showRewardedAd } from '../platform/ads.js';
import { saveGame } from '../platform/storage.js';

/**
 * UpgradeMenu — the TUNING purchases in one DOM overlay, opened by its own
 * corner button (top-left). Create/hire purchases (expand lots, equip, hire
 * workers, open the market/station) live at physical world markers instead —
 * see core/upgrades.getUnlockMarkers + scene/UnlockMarkers.js. Sections here:
 * Automation, Supermarket (train/breaks/deliveries), Workers (speed/fixing/
 * breaks per equipped pit), Attendants (speed/breaks per hired pump), and
 * Advertising (permanent rep purchase + rewarded-ad boost) at the bottom.
 *
 * Hidden until open(); the structure can change while open (pits get
 * equipped/hired at their markers) so update() rebuilds the DOM when the row
 * signature changes and only refreshes text/disabled state otherwise.
 */
export class UpgradeMenu {
  constructor(state) {
    this.state = state;
    this.isOpen = false;
    this.rowEls = new Map(); // rowKey -> { effect, button }
    this.sig = '';

    this.#buildButton();
    this.#buildPanel();
  }

  #buildButton() {
    const btn = document.createElement('button');
    btn.textContent = '📱 Upgrades';
    Object.assign(btn.style, {
      position: 'fixed',
      left: '14px',
      top: '14px',
      padding: '10px 14px',
      borderRadius: '10px',
      border: 'none',
      background: '#ffd23f',
      color: '#1a1400',
      fontWeight: '800',
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      cursor: 'pointer',
      zIndex: '17',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
    });
    btn.addEventListener('click', () => this.toggle());
    document.body.appendChild(btn);
    this.button = btn;
  }

  // The panel is dressed as a PHONE: a dark bezel frame with heavily rounded
  // corners, a notch pill at the top, an app-bar header, and a home-indicator
  // bar under the scrolling "screen". Pure CSS/DOM — no 3D involved.
  #buildPanel() {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '10px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'none',
      flexDirection: 'column',
      width: '224px',
      maxHeight: '88vh',
      background: 'linear-gradient(180deg, #12151d 0%, #0b0d13 100%)',
      border: '7px solid #23262e',
      borderRadius: '34px',
      boxShadow: '0 14px 40px rgba(0,0,0,0.6), inset 0 0 0 2px #05060a',
      padding: '10px 12px 12px',
      zIndex: '16',
      fontFamily: "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
      color: '#e7ecf2',
    });

    // The notch: a centred dark pill "cut into" the top of the screen.
    const notch = document.createElement('div');
    Object.assign(notch.style, {
      width: '80px',
      height: '17px',
      margin: '-4px auto 8px',
      background: '#23262e',
      borderRadius: '0 0 12px 12px',
      flexShrink: '0',
    });
    panel.appendChild(notch);

    // App bar: title + close, like a phone app's header.
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '8px',
      paddingBottom: '7px',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      flexShrink: '0',
    });
    const title = document.createElement('div');
    title.textContent = '📱 Upgrades';
    Object.assign(title.style, { fontWeight: '800', fontSize: '16px', letterSpacing: '0.3px' });
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      width: '26px',
      height: '26px',
      borderRadius: '13px',
      border: 'none',
      background: '#2b303b',
      color: '#e7ecf2',
      fontWeight: '800',
      cursor: 'pointer',
    });
    closeBtn.addEventListener('click', () => this.close());
    header.append(title, closeBtn);
    panel.appendChild(header);

    const content = document.createElement('div');
    Object.assign(content.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      overflowY: 'auto',
      userSelect: 'none',
    });
    panel.appendChild(content);
    this.content = content;

    // Home-indicator bar under the screen, closing the phone silhouette.
    const homeBar = document.createElement('div');
    Object.assign(homeBar.style, {
      width: '86px',
      height: '4px',
      margin: '10px auto 0',
      background: 'rgba(255,255,255,0.28)',
      borderRadius: '4px',
      flexShrink: '0',
    });
    panel.appendChild(homeBar);

    document.body.appendChild(panel);
    this.panel = panel;
  }

  open() {
    this.isOpen = true;
    this.panel.style.display = 'flex';
    this.update(this.state);
  }

  close() {
    this.isOpen = false;
    this.panel.style.display = 'none';
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Called every frame from main.js; cheap no-op while closed. */
  update(state) {
    if (!this.isOpen) return;
    const model = getMenuModel(state);
    const sig = structureSignature(model);
    if (sig !== this.sig) {
      this.sig = sig;
      this.#rebuild(model);
    } else {
      this.#refresh(model);
    }
  }

  // --- DOM building --------------------------------------------------------

  #rebuild(model) {
    this.content.replaceChildren();
    this.rowEls.clear();

    // Create/hire purchases live at their world markers (scene/UnlockMarkers.js),
    // so the phone carries tuning sections only — and skips any that are empty
    // (e.g. Supermarket before it's been opened at its floor marker).
    this.content.appendChild(this.#sectionHeader('Automation'));
    this.content.appendChild(this.#card(null, model.automation));

    if (model.supermarket.length > 0) {
      this.content.appendChild(this.#sectionHeader('Supermarket'));
      this.content.appendChild(this.#card(null, model.supermarket));
    }

    if (model.workers.length > 0) {
      this.content.appendChild(this.#sectionHeader('Workers'));
      for (const worker of model.workers) {
        this.content.appendChild(this.#card(worker.title, worker.rows));
      }
    }

    if (model.attendants.length > 0) {
      this.content.appendChild(this.#sectionHeader('Attendants'));
      for (const attendant of model.attendants) {
        this.content.appendChild(this.#card(attendant.title, attendant.rows));
      }
    }

    this.content.appendChild(this.#sectionHeader('Advertising'));
    this.content.appendChild(this.#buildAdvertising());

    this.#refresh(model);
  }

  // The Advertising card — reputation readout + the two reputation actions
  // (permanent Buy Advertising, temporary rewarded-ad boost). Doesn't use the
  // generic getMenuModel rows: it has its own view model (getReputationMenuModel)
  // and two buttons, so it's built/refreshed separately.
  #buildAdvertising() {
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: 'rgba(255,255,255,0.055)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '16px',
      padding: '9px 11px',
    });

    this.adRepLine = document.createElement('div');
    Object.assign(this.adRepLine.style, { fontSize: '12px', color: '#9fb0c0', marginBottom: '4px' });

    this.adBoostLine = document.createElement('div');
    Object.assign(this.adBoostLine.style, { fontSize: '11px', color: '#ffd23f', minHeight: '14px', marginBottom: '6px' });

    this.adBuyBtn = this.#adButton();
    this.adBuyBtn.addEventListener('click', () => {
      if (buyAdvertising(this.state)) {
        this.update(this.state);
        saveGame(this.state);
      }
    });

    this.adWatchBtn = this.#adButton();
    this.adWatchBtn.addEventListener('click', () => {
      if (this.state.repBoostRemaining > 0) return;
      showRewardedAd(
        () => {
          activateRepBoost(this.state);
          this.update(this.state);
          saveGame(this.state);
        },
        () => this.update(this.state)
      );
    });

    card.append(this.adRepLine, this.adBoostLine, this.adBuyBtn, this.adWatchBtn);
    return card;
  }

  #adButton() {
    const b = document.createElement('button');
    Object.assign(b.style, {
      width: '100%',
      padding: '6px 6px',
      borderRadius: '11px',
      border: 'none',
      fontWeight: '800',
      fontSize: '13px',
      cursor: 'pointer',
      marginBottom: '6px',
    });
    return b;
  }

  #sectionHeader(text) {
    const h = document.createElement('div');
    h.textContent = text.toUpperCase();
    Object.assign(h.style, {
      fontSize: '10px',
      fontWeight: '800',
      letterSpacing: '1.4px',
      color: '#5fd98b',
      paddingBottom: '2px',
      marginTop: '2px',
    });
    return h;
  }

  #card(title, rows) {
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: 'rgba(255,255,255,0.055)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '16px',
      padding: '9px 11px',
    });

    if (title) {
      const heading = document.createElement('div');
      heading.textContent = title;
      Object.assign(heading.style, { fontWeight: '800', fontSize: '15px', marginBottom: '6px' });
      card.appendChild(heading);
    }

    for (const row of rows) card.appendChild(this.#row(row));
    return card;
  }

  #row(row) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { marginBottom: '8px' });

    const label = document.createElement('div');
    label.textContent = row.label;
    Object.assign(label.style, { fontSize: '13px', fontWeight: '700', marginBottom: '1px' });

    const effect = document.createElement('div');
    Object.assign(effect.style, { fontSize: '11px', color: '#9fb0c0', marginBottom: '5px', minHeight: '14px' });

    const button = document.createElement('button');
    Object.assign(button.style, {
      width: '100%',
      padding: '6px 6px',
      borderRadius: '11px',
      border: 'none',
      fontWeight: '800',
      fontSize: '13px',
      cursor: 'pointer',
    });
    button.addEventListener('click', () => this.#buy(row.kind, row.pitIndex));

    wrap.append(label, effect, button);
    this.rowEls.set(rowKey(row), { effect, button });
    return wrap;
  }

  // --- live refresh --------------------------------------------------------

  #refresh(model) {
    for (const row of model.automation) this.#refreshRow(row);
    for (const row of model.supermarket) this.#refreshRow(row);
    for (const worker of model.workers) for (const row of worker.rows) this.#refreshRow(row);
    for (const attendant of model.attendants) for (const row of attendant.rows) this.#refreshRow(row);
    this.#refreshAdvertising();
  }

  #refreshAdvertising() {
    if (!this.adRepLine) return;
    const m = getReputationMenuModel(this.state);

    this.adRepLine.textContent = m.boostActive
      ? `Reputation: ${m.permanentPct}% (boosted to ${m.effectivePct}%)`
      : `Reputation: ${m.permanentPct}%`;
    this.adBoostLine.textContent = m.boostActive ? `Ad boost active — ${mmss(m.boostRemaining)}` : '';

    this.adBuyBtn.textContent = m.atCap
      ? 'Reputation MAXED'
      : `Buy Advertising (+${Math.round(settings.reputation.repStep * 100)}%) — ${m.adCostLabel}`;
    setAdButton(this.adBuyBtn, m.adDisabled);

    if (m.boostActive) {
      this.adWatchBtn.textContent = `Ad active — ${mmss(m.boostRemaining)}`;
      setAdButton(this.adWatchBtn, true);
    } else {
      // Derived from settings so the promise always matches what the boost does.
      const R = settings.reputation;
      this.adWatchBtn.textContent = `Watch Ad — ${R.boostMultiplier}× chance for ${mmss(R.boostDurationSeconds)}`;
      setAdButton(this.adWatchBtn, false);
    }
  }

  #refreshRow(row) {
    const el = this.rowEls.get(rowKey(row));
    if (!el) return;
    el.effect.textContent = row.effect;
    el.button.textContent = row.cost;
    el.button.disabled = row.disabled;
    el.button.style.opacity = row.disabled ? '0.45' : '1';
    el.button.style.cursor = row.disabled ? 'default' : 'pointer';
    el.button.style.background = row.disabled ? '#3a434f' : '#3ad06a';
    el.button.style.color = row.disabled ? '#9fb0c0' : '#06310f';
  }

  // --- purchases -----------------------------------------------------------

  #buy(kind, pitIndex) {
    let ok = false;
    switch (kind) {
      case 'workerSpeed':
        ok = buyWorkerSpeed(this.state, pitIndex);
        break;
      case 'fixingTime':
        ok = buyFixingTime(this.state, pitIndex);
        break;
      case 'autoRestock':
        ok = buyAutoRestock(this.state);
        break;
      case 'trainMarketWorker':
        ok = trainMarketWorker(this.state);
        break;
      case 'breakRoom':
        ok = buyBreakRoom(this.state, pitIndex);
        break;
      case 'marketBreakRoom':
        ok = buyMarketBreakRoom(this.state);
        break;
      case 'truckFrequency':
        ok = buyTruckFrequency(this.state);
        break;
      case 'attendantSpeed':
        ok = buyAttendantSpeed(this.state, pitIndex);
        break;
      case 'gasBreakRoom':
        ok = buyGasBreakRoom(this.state, pitIndex);
        break;
    }
    if (ok) {
      this.update(this.state);
      saveGame(this.state);
    }
  }
}

// A stable key per row (kind + pit). Expand Room has no pit.
function rowKey(row) {
  return row.pitIndex === undefined ? row.kind : `${row.kind}:${row.pitIndex}`;
}

// Style an advertising button by its disabled state (mirrors #refreshRow's button styling).
function setAdButton(btn, disabled) {
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

// Changes whenever the set/shape of rows changes (equip, hire, train).
function structureSignature(model) {
  const automation = model.automation.map(rowKey).join(',');
  const supermarket = model.supermarket.map(rowKey).join(',');
  const workers = model.workers.map((w) => `${w.index}:${w.rows.map((r) => r.kind).join('')}`).join('|');
  const attendants = model.attendants.map((w) => `${w.index}:${w.rows.map((r) => r.kind).join('')}`).join('|');
  return `A[${automation}]S[${supermarket}]W[${workers}]P[${attendants}]`;
}
