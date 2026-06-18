import { getUpgradeViews, buyUpgrade } from '../core/upgrades.js';

/**
 * UpgradeMenu — DOM panel of upgrade cards (Mechanic, Worker Speed, Fixing Time).
 * Each card shows its current effect + next cost and a buy button that calls
 * buyUpgrade. update(state) refreshes effects, prices and disabled state live.
 *
 * It's a separate DOM overlay, so taps on it never reach the canvas (they don't
 * count as repair/hurry taps).
 */
export class UpgradeMenu {
  constructor(state) {
    this.state = state;
    this.rows = new Map(); // id -> { card, effect, button, lastKey }

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '10px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      width: '168px',
      zIndex: '16',
      fontFamily: 'Arial, sans-serif',
    });

    for (const view of getUpgradeViews(state)) {
      panel.appendChild(this.#buildCard(view));
    }

    document.body.appendChild(panel);
    this.panel = panel;
    this.update(state);
  }

  #buildCard(view) {
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: 'rgba(18,22,28,0.82)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '10px',
      padding: '8px 10px',
      color: '#e7ecf2',
      userSelect: 'none',
    });

    const title = document.createElement('div');
    title.textContent = view.label;
    Object.assign(title.style, { fontWeight: '800', fontSize: '15px', marginBottom: '2px' });

    const effect = document.createElement('div');
    Object.assign(effect.style, { fontSize: '12px', color: '#9fb0c0', marginBottom: '6px', minHeight: '15px' });

    const button = document.createElement('button');
    Object.assign(button.style, {
      width: '100%',
      padding: '7px 6px',
      borderRadius: '7px',
      border: 'none',
      fontWeight: '800',
      fontSize: '14px',
      cursor: 'pointer',
    });
    button.addEventListener('click', () => {
      if (buyUpgrade(this.state, view.id)) this.update(this.state);
    });

    card.append(title, effect, button);
    this.rows.set(view.id, { card, effect, button, lastKey: '' });
    return card;
  }

  update(state) {
    for (const view of getUpgradeViews(state)) {
      const row = this.rows.get(view.id);
      // Only touch the DOM when something changed.
      const key = `${view.effect}|${view.cost}|${view.disabled}`;
      if (key === row.lastKey) continue;
      row.lastKey = key;

      row.effect.textContent = view.effect;
      row.button.textContent = view.cost;
      row.button.disabled = view.disabled;
      row.button.style.opacity = view.disabled ? '0.45' : '1';
      row.button.style.cursor = view.disabled ? 'default' : 'pointer';
      row.button.style.background = view.disabled ? '#3a434f' : '#3ad06a';
      row.button.style.color = view.disabled ? '#9fb0c0' : '#06310f';
    }
  }
}
