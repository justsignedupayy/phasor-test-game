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
import { orderTruck } from '../core/supermarket.js';
import { getReputationMenuModel, buyAdvertising, activateRepBoost } from '../core/reputation.js';
import { showRewardedAd } from '../platform/ads.js';
import { saveGame } from '../platform/storage.js';

/**
 * UpgradeMenu — the TUNING purchases in one DOM overlay, opened by its own
 * corner button (top-left). Create/hire purchases (expand lots, equip, hire
 * workers, open the market/station) live at physical world markers instead —
 * see core/upgrades.getUnlockMarkers + scene/UnlockMarkers.js.
 *
 * The panel is dressed as a TABLET, its upgrades split across four category
 * tabs (left to right): Garage (auto-restock + per-pit worker tuning), Market
 * (train/breaks/truck), Gas Station (per-pump attendant tuning) and
 * Advertising (permanent rep purchase + rewarded-ad boost). Only the active
 * tab's rows exist in the DOM at a time.
 *
 * Hidden until open(); the structure can change while open (pits get
 * equipped/hired at their markers, tabs switch) so update() rebuilds the DOM
 * when the row signature — which includes the active tab — changes, and only
 * refreshes text/disabled state otherwise.
 */
export class UpgradeMenu {
  constructor(state) {
    this.state = state;
    this.isOpen = false;
    this.rowEls = new Map(); // rowKey -> { effect, button }
    this.sig = '';
    this.activeTab = 'garage'; // 'garage' | 'market' | 'gas' | 'ads'

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

  // The panel is dressed as a TABLET: a wider screen in a slim, even dark
  // bezel with moderately rounded corners, a front-camera dot at the top (no
  // phone notch), an app-bar header, the category tab strip, and a
  // home-indicator bar under the scrolling "screen". Pure CSS/DOM — no 3D.
  #buildPanel() {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '10px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'none',
      flexDirection: 'column',
      // A proper tablet-sized surface, clamped so it still fits small screens.
      width: '1050px',
      maxWidth: 'calc(100vw - 20px)',
      // FIXED height: the frame never grows/shrinks with the active tab's
      // content — a sparse category shows empty screen below its rows, a dense
      // one scrolls inside the content area (which flexes to fill the rest).
      height: 'min(840px, 88vh)',
      background: 'linear-gradient(180deg, #12151d 0%, #0b0d13 100%)',
      border: '12px solid #23262e',
      borderRadius: '26px',
      boxShadow: '0 14px 40px rgba(0,0,0,0.6), inset 0 0 0 2px #05060a',
      padding: '8px 16px 12px',
      zIndex: '16',
      fontFamily: "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
      color: '#e7ecf2',
    });

    // Front camera: a small centred lens dot where the phone's notch used to be.
    const camera = document.createElement('div');
    Object.assign(camera.style, {
      width: '8px',
      height: '8px',
      margin: '0 auto 6px',
      background: '#05060a',
      border: '2px solid #1c2029',
      borderRadius: '50%',
      flexShrink: '0',
    });
    panel.appendChild(camera);

    // App bar: title + close, like a tablet app's header.
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

    this.#buildTabs(panel);

    const content = document.createElement('div');
    Object.assign(content.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      // Fill whatever the fixed-height frame leaves after the header/tabs/home
      // bar, and scroll internally past that — the frame itself never resizes.
      flex: '1 1 auto',
      minHeight: '0',
      overflowY: 'auto',
      userSelect: 'none',
    });
    panel.appendChild(content);
    this.content = content;

    // Home-indicator bar under the screen, closing the tablet silhouette.
    const homeBar = document.createElement('div');
    Object.assign(homeBar.style, {
      width: '130px',
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

  // The four category tabs, left to right; exactly one is active and only its
  // rows are built (see #rebuild + structureSignature).
  #buildTabs(panel) {
    const TABS = [
      ['garage', 'Garage'],
      ['market', 'Market'],
      ['gas', 'Gas Station'],
      ['ads', 'Advertising'],
    ];
    const bar = document.createElement('div');
    Object.assign(bar.style, { display: 'flex', gap: '5px', marginBottom: '8px', flexShrink: '0' });
    this.tabButtons = new Map();
    for (const [key, label] of TABS) {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        flex: '1',
        padding: '7px 2px',
        borderRadius: '9px',
        border: 'none',
        fontWeight: '800',
        fontSize: '11px',
        fontFamily: 'inherit',
        cursor: 'pointer',
      });
      b.addEventListener('click', () => this.#selectTab(key));
      bar.appendChild(b);
      this.tabButtons.set(key, b);
    }
    panel.appendChild(bar);
    this.#styleTabs();
  }

  #selectTab(key) {
    if (this.activeTab === key) return;
    this.activeTab = key;
    this.#styleTabs();
    if (this.isOpen) this.update(this.state); // the signature includes the tab → rebuilds now
  }

  /** Active tab reads as the pressed key; the rest recede into the bezel. */
  #styleTabs() {
    for (const [key, b] of this.tabButtons) {
      const active = key === this.activeTab;
      b.style.background = active ? '#3ad06a' : 'rgba(255,255,255,0.07)';
      b.style.color = active ? '#06310f' : '#9fb0c0';
    }
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
    const sig = structureSignature(model, this.activeTab);
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
    this.adRepLine = null; // recreated below only while the Advertising tab is up

    // Create/hire purchases live at their world markers (scene/UnlockMarkers.js),
    // so the tablet carries tuning upgrades only, split across the category
    // tabs — only the active tab's rows are built. A category whose content
    // hasn't been unlocked yet shows a hint instead of an empty screen.
    if (this.activeTab === 'garage') {
      this.content.appendChild(this.#sectionHeader('Automation'));
      this.content.appendChild(this.#card(null, model.automation));
      if (model.workers.length > 0) {
        this.content.appendChild(this.#sectionHeader('Workers'));
        const grid = this.#cardGrid();
        for (const worker of model.workers) grid.appendChild(this.#card(worker.title, worker.rows));
        this.content.appendChild(grid);
      }
    } else if (this.activeTab === 'market') {
      if (model.supermarket.length > 0) {
        this.content.appendChild(this.#sectionHeader('Supermarket'));
        this.content.appendChild(this.#card(null, model.supermarket));
      } else {
        this.content.appendChild(this.#placeholder('Open the supermarket at its floor marker to unlock these upgrades.'));
      }
    } else if (this.activeTab === 'gas') {
      if (model.attendants.length > 0) {
        this.content.appendChild(this.#sectionHeader('Attendants'));
        const grid = this.#cardGrid();
        for (const attendant of model.attendants) grid.appendChild(this.#card(attendant.title, attendant.rows));
        this.content.appendChild(grid);
      } else {
        this.content.appendChild(this.#placeholder('Open the gas station and hire attendants to unlock these upgrades.'));
      }
    } else {
      this.content.appendChild(this.#sectionHeader('Advertising'));
      this.content.appendChild(this.#buildAdvertising());
    }

    this.#refresh(model);
  }

  /** Two-column card grid for the per-worker blocks — uses the tablet's width. */
  #cardGrid() {
    const grid = document.createElement('div');
    Object.assign(grid.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' });
    return grid;
  }

  /** Shown on a tab whose category isn't unlocked yet — a hint, not an empty screen. */
  #placeholder(text) {
    const p = document.createElement('div');
    p.textContent = text;
    Object.assign(p.style, {
      background: 'rgba(255,255,255,0.04)',
      border: '1px dashed rgba(255,255,255,0.14)',
      borderRadius: '16px',
      padding: '18px 14px',
      fontSize: '12px',
      color: '#9fb0c0',
      textAlign: 'center',
    });
    return p;
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
      case 'orderTruck':
        ok = orderTruck(this.state); // free: places the delivery order, no cash involved
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

// Changes whenever the set/shape of rows changes (equip, hire, train) OR the
// active tab switches — either way the DOM is rebuilt for the visible category.
function structureSignature(model, activeTab) {
  const automation = model.automation.map(rowKey).join(',');
  const supermarket = model.supermarket.map(rowKey).join(',');
  const workers = model.workers.map((w) => `${w.index}:${w.rows.map((r) => r.kind).join('')}`).join('|');
  const attendants = model.attendants.map((w) => `${w.index}:${w.rows.map((r) => r.kind).join('')}`).join('|');
  return `${activeTab}|A[${automation}]S[${supermarket}]W[${workers}]P[${attendants}]`;
}
