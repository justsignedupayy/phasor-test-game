import {
  getMenuModel,
  buyExpandRoom,
  buyPitEquipment,
  hireMechanic,
  buyWorkerSpeed,
  buyFixingTime,
  buyCashier,
  buyConveyor,
  buySupermarket,
  hireMarketWorker,
  trainMarketWorker,
  buyBreakRoom,
  buyMarketBreakRoom,
  buyTruckFrequency,
} from '../core/upgrades.js';
import { saveGame } from '../platform/storage.js';

/**
 * UpgradeMenu — every progression purchase in one DOM overlay, opened by its
 * own corner button (top-left). Two sections: Garage (Expand Room + Buy Pit
 * Equipment for any roomUnlocked-but-unequipped pit) and Workers (one
 * "Worker X" card per equipped pit — Hire Worker until hired, then Worker
 * Speed, plus Fixing Time). The Advertising panel at the computer is the only
 * purchase UI that stays outside this menu.
 *
 * Hidden until open(); the structure can change while open (lots open, pits
 * get equipped/hired) so update() rebuilds the DOM when the row signature
 * changes and only refreshes text/disabled state otherwise.
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
    btn.textContent = '⚙ Upgrades';
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

  #buildPanel() {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '10px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'none',
      flexDirection: 'column',
      width: '198px',
      maxHeight: '92vh',
      background: 'rgba(18,22,28,0.92)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '12px',
      padding: '12px',
      zIndex: '16',
      fontFamily: 'Arial, sans-serif',
      color: '#e7ecf2',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '8px',
      flexShrink: '0',
    });
    const title = document.createElement('div');
    title.textContent = 'Upgrades';
    Object.assign(title.style, { fontWeight: '800', fontSize: '17px' });
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
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

    this.content.appendChild(this.#sectionHeader('Garage'));
    this.content.appendChild(this.#card(null, model.garage));

    this.content.appendChild(this.#sectionHeader('Cashier'));
    this.content.appendChild(this.#card(null, model.cashier));

    this.content.appendChild(this.#sectionHeader('Automation'));
    this.content.appendChild(this.#card(null, model.automation));

    this.content.appendChild(this.#sectionHeader('Supermarket'));
    this.content.appendChild(this.#card(null, model.supermarket));

    this.content.appendChild(this.#sectionHeader('Workers'));
    for (const worker of model.workers) {
      this.content.appendChild(this.#card(worker.title, worker.rows));
    }

    this.#refresh(model);
  }

  #sectionHeader(text) {
    const h = document.createElement('div');
    h.textContent = text.toUpperCase();
    Object.assign(h.style, {
      fontSize: '11px',
      fontWeight: '800',
      letterSpacing: '1px',
      color: '#9fb0c0',
      borderBottom: '1px solid rgba(255,255,255,0.18)',
      paddingBottom: '3px',
    });
    return h;
  }

  #card(title, rows) {
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: '10px',
      padding: '8px 10px',
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
      borderRadius: '7px',
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
    for (const row of model.garage) this.#refreshRow(row);
    for (const row of model.cashier) this.#refreshRow(row);
    for (const row of model.automation) this.#refreshRow(row);
    for (const row of model.supermarket) this.#refreshRow(row);
    for (const worker of model.workers) for (const row of worker.rows) this.#refreshRow(row);
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
      case 'expand':
        ok = buyExpandRoom(this.state);
        break;
      case 'equipment':
        ok = buyPitEquipment(this.state, pitIndex);
        break;
      case 'hire':
        ok = hireMechanic(this.state, pitIndex);
        break;
      case 'workerSpeed':
        ok = buyWorkerSpeed(this.state, pitIndex);
        break;
      case 'fixingTime':
        ok = buyFixingTime(this.state, pitIndex);
        break;
      case 'cashier':
        ok = buyCashier(this.state);
        break;
      case 'conveyor':
        ok = buyConveyor(this.state);
        break;
      case 'openMarket':
        ok = buySupermarket(this.state);
        break;
      case 'hireMarketWorker':
        ok = hireMarketWorker(this.state);
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

// Changes whenever the set/shape of rows changes (lots open, equip, hire).
function structureSignature(model) {
  const garage = model.garage.map(rowKey).join(',');
  const cashier = model.cashier.map(rowKey).join(',');
  const automation = model.automation.map(rowKey).join(',');
  const supermarket = model.supermarket.map(rowKey).join(',');
  const workers = model.workers.map((w) => `${w.index}:${w.rows.map((r) => r.kind).join('')}`).join('|');
  return `G[${garage}]C[${cashier}]A[${automation}]S[${supermarket}]W[${workers}]`;
}
