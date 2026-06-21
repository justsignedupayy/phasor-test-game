import {
  getMenuModel,
  buyExpandRoom,
  buyPitEquipment,
  hireMechanic,
  buyWorkerSpeed,
  buyFixingTime,
} from '../core/upgrades.js';

/**
 * UpgradeMenu — DOM overlay with a Garage block (Expand Room) followed by one
 * block per roomUnlocked pit ("Pit A / Worker A", ...). An unequipped pit shows
 * only Buy Pit Equipment; once equipped it shows Hire Worker (until hired),
 * Worker Speed and Fixing Time. Each row has a buy button calling the matching
 * per-pit function.
 *
 * The panel's structure changes at runtime (lots open, pits get equipped/hired),
 * so update() rebuilds the DOM when the structure's signature changes and only
 * refreshes text/disabled state otherwise. It's a separate overlay, so taps on it
 * never reach the canvas.
 */
export class UpgradeMenu {
  constructor(state) {
    this.state = state;
    this.rowEls = new Map(); // rowKey -> { effect, button }
    this.sig = '';

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '10px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      width: '178px',
      maxHeight: '92vh',
      overflowY: 'auto',
      zIndex: '16',
      fontFamily: 'Arial, sans-serif',
    });
    document.body.appendChild(panel);
    this.panel = panel;

    this.update(state);
  }

  update(state) {
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
    this.panel.replaceChildren();
    this.rowEls.clear();

    // Garage block (Expand Room).
    this.panel.appendChild(this.#block('Garage', [model.expand]));

    // One block per roomUnlocked pit.
    for (const pit of model.pits) {
      this.panel.appendChild(this.#block(pit.title, pit.rows));
    }

    this.#refresh(model);
  }

  #block(title, rows) {
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: 'rgba(18,22,28,0.82)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '10px',
      padding: '8px 10px',
      color: '#e7ecf2',
      userSelect: 'none',
    });

    const heading = document.createElement('div');
    heading.textContent = title;
    Object.assign(heading.style, { fontWeight: '800', fontSize: '15px', marginBottom: '6px' });
    card.appendChild(heading);

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
    this.#refreshRow(model.expand);
    for (const pit of model.pits) for (const row of pit.rows) this.#refreshRow(row);
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
    }
    if (ok) this.update(this.state);
  }
}

// A stable key per row (kind + pit). Expand Room has no pit.
function rowKey(row) {
  return row.pitIndex === undefined ? row.kind : `${row.kind}:${row.pitIndex}`;
}

// Changes whenever the set/shape of blocks changes (lots open, equip, hire).
function structureSignature(model) {
  const expand = model.expand.disabled && model.expand.cost === 'MAX' ? 'x' : 'o';
  const pits = model.pits.map((p) => `${p.index}${p.equipped ? 'E' : 'r'}${p.rows.map((r) => r.kind).join('')}`);
  return `${expand}|${pits.join('|')}`;
}
