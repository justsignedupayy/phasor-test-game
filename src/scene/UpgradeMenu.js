import {
  getMenuModel,
  buyWorkerSpeed,
  buyFixingTime,
  buyAutoRestock,
  trainMarketWorker,
  buyTruckFrequency,
  buyAttendantSpeed,
  buyBreakDuration,
  buyBreakThreshold,
  buyPlayerSpeed,
} from '../core/upgrades.js';
import settings from '../config/settings.js';
import { orderTruck } from '../core/supermarket.js';
import { getReputationMenuModel, buyAdvertising, watchAdForReputation } from '../core/reputation.js';
import { showRewardedAd } from '../platform/ads.js';
import { saveGame } from '../platform/storage.js';

export class UpgradeMenu {
  constructor(state) {
    this.state = state;
    this.isOpen = false;
    this.rowEls = new Map(); // rowKey -> { wrap, label, effect, button }
    this.sig = '';
    this.activeTab = 'garage'; // 'garage' | 'market' | 'gas' | 'player' | 'ads'

    this.#buildButton();
    this.#buildPanel();
  }

  #buildButton() {
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      position: 'fixed',
      top: 'env(safe-area-inset-top, 0px)',
      left: '22px',
      border: 'none',
      padding: '0',
      background: 'transparent',
      cursor: 'pointer',
      zIndex: '17',
      WebkitTapHighlightColor: 'transparent',
    });

    const tab = document.createElement('span');
    Object.assign(tab.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '9px',
      padding: '12px 16px 10px 13px',
      borderRadius: '0 0 16px 16px',
      background: 'linear-gradient(180deg, #3c4551 0%, #333c47 100%)',
      border: '1px solid #4d5865',
      borderTop: 'none',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 16px rgba(0,0,0,0.5)',
      transition: 'transform 140ms ease-out',
      transform: 'translateY(0) scale(1)',
    });

    const iconTile = document.createElement('span');
    Object.assign(iconTile.style, {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: '0',
      width: '24px',
      height: '24px',
      borderRadius: '7px',
      background: 'radial-gradient(120% 120% at 50% 25%, #22303a 0%, #182129 100%)',
      border: '1px solid rgba(58,208,106,0.45)',
      boxShadow: '0 0 10px rgba(58,208,106,0.45)',
    });

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.style.filter = 'drop-shadow(0 0 3px rgba(58,208,106,0.75))';
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M12 20 V6 M12 6 L6 12 M12 6 L18 12');
    path.setAttribute('stroke', '#3ad06a');
    path.setAttribute('stroke-width', '2.6');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    iconTile.appendChild(svg);

    const label = document.createElement('span');
    label.textContent = 'Upgrades';
    Object.assign(label.style, {
      fontFamily: FONT,
      fontWeight: '600',
      fontSize: '14px',
      letterSpacing: '0.02em',
      color: '#eaf1f7',
      textShadow: '0 1px 1px rgba(0,0,0,0.5)',
    });

    tab.append(iconTile, label);
    btn.appendChild(tab);

    const press = () => { tab.style.transform = 'translateY(1px) scale(0.97)'; };
    const release = () => { tab.style.transform = 'translateY(0) scale(1)'; };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('click', () => this.toggle());

    document.body.appendChild(btn);
    this.button = btn;
  }

  #buildPanel() {
    injectMenuStylesheet();

    const rim = document.createElement('div');
    Object.assign(rim.style, {
      position: 'fixed',
      right: '10px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'none',
      flexDirection: 'column',
      width: '1050px',
      maxWidth: 'calc(100vw - 20px)',
      height: 'min(840px, 88vh)',
      padding: '3px',
      borderRadius: '52px',
      background: 'linear-gradient(150deg,#4a4f57 0%,#23272e 30%,#0f1116 70%,#33383f 100%)',
      boxShadow: '0 60px 120px -40px rgba(0,0,0,0.9), 0 8px 24px -8px rgba(0,0,0,0.6)',
      zIndex: '16',
      fontFamily: FONT,
      color: '#eef2f6',
      userSelect: 'none',
    });

    const bezel = document.createElement('div');
    Object.assign(bezel.style, {
      flex: '1',
      minHeight: '0',
      display: 'flex',
      flexDirection: 'column',
      padding: '22px',
      borderRadius: '49px',
      background: 'linear-gradient(155deg,#1c1f25,#101318 55%,#0a0c10)',
      boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.08), inset 0 -3px 6px rgba(0,0,0,0.7)',
      position: 'relative',
    });
    rim.appendChild(bezel);

    const camera = document.createElement('div');
    Object.assign(camera.style, {
      position: 'absolute',
      top: '11px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '9px',
      height: '9px',
      borderRadius: '50%',
      background: 'radial-gradient(circle at 38% 32%,#2f3944,#05070a)',
      boxShadow: 'inset 0 0 2px rgba(90,150,210,0.5), 0 0 0 2px rgba(255,255,255,0.03)',
    });
    bezel.appendChild(camera);

    const screen = document.createElement('div');
    Object.assign(screen.style, {
      flex: '1',
      minHeight: '0',
      display: 'flex',
      flexDirection: 'column',
      borderRadius: '30px',
      overflow: 'hidden',
      background: 'radial-gradient(130% 90% at 50% -10%,#1c222c 0%,#141922 55%,#0e121a 100%)',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
      position: 'relative',
    });
    bezel.appendChild(screen);

    const sheen = document.createElement('div');
    Object.assign(sheen.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      background: 'linear-gradient(150deg,rgba(255,255,255,0.06) 0%,rgba(255,255,255,0.015) 18%,transparent 42%)',
      zIndex: '5',
    });
    screen.appendChild(sheen);

    screen.appendChild(buildStatusBar());

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 24px 14px',
      flexShrink: '0',
      position: 'relative',
      zIndex: '6',
    });
    const titleGroup = document.createElement('div');
    Object.assign(titleGroup.style, { display: 'flex', alignItems: 'center', gap: '12px' });
    const appIcon = document.createElement('div');
    Object.assign(appIcon.style, {
      width: '34px',
      height: '34px',
      borderRadius: '12px',
      background: 'linear-gradient(160deg,#2a323d,#1a2029)',
      boxShadow: '0 4px 10px -3px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });
    const appGlyph = document.createElement('span');
    appGlyph.textContent = '📱';
    appGlyph.style.fontSize = '18px';
    appIcon.appendChild(appGlyph);
    const title = document.createElement('span');
    title.textContent = 'Upgrades';
    Object.assign(title.style, { color: '#f4f7fa', fontSize: '21px', fontWeight: '800' });
    titleGroup.append(appIcon, title);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      width: '44px',
      height: '44px',
      borderRadius: '50%',
      border: 'none',
      background: 'linear-gradient(180deg,#252d38,#1a212a)',
      boxShadow: '0 4px 10px -3px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)',
      color: '#9fb0c0',
      fontSize: '16px',
      fontWeight: '800',
      fontFamily: 'inherit',
      cursor: 'pointer',
      flexShrink: '0',
    });
    closeBtn.addEventListener('click', () => this.close());
    header.append(titleGroup, closeBtn);
    screen.appendChild(header);

    this.#buildTabs(screen);

    const content = document.createElement('div');
    content.className = 'um-content';
    Object.assign(content.style, {
      flex: '1 1 auto',
      minHeight: '0',
      overflowY: 'auto',
      padding: '0 24px 8px',
      position: 'relative',
      zIndex: '6',
    });
    screen.appendChild(content);
    this.content = content;

    const homeWrap = document.createElement('div');
    Object.assign(homeWrap.style, {
      display: 'flex',
      justifyContent: 'center',
      padding: '14px 0 12px',
      flexShrink: '0',
      position: 'relative',
      zIndex: '6',
    });
    const homeBar = document.createElement('div');
    Object.assign(homeBar.style, {
      width: '150px',
      height: '5px',
      borderRadius: '3px',
      background: 'rgba(199,210,220,0.35)',
    });
    homeWrap.appendChild(homeBar);
    screen.appendChild(homeWrap);

    document.body.appendChild(rim);
    this.panel = rim;
  }

  #buildTabs(parent) {
    const TABS = [
      ['garage', 'Garage', 'Garage'],
      ['market', 'Market', 'Market'],
      ['gas', 'Gas Station', 'Gas'],
      ['player', 'Player', 'Player'],
      ['ads', 'Advertising', 'Ads'],
    ];
    const barWrap = document.createElement('div');
    Object.assign(barWrap.style, {
      position: 'relative',
      flexShrink: '0',
      zIndex: '6',
    });
    const bar = document.createElement('div');
    bar.className = 'um-tabbar'; // hides the webkit scrollbar (see injectMenuStylesheet)
    Object.assign(bar.style, {
      display: 'flex',
      gap: '9px',
      padding: '0 24px 12px',
      overflowX: 'auto',
      WebkitOverflowScrolling: 'touch',
      scrollbarWidth: 'none', // Firefox
    });
    const fade = document.createElement('div');
    Object.assign(fade.style, {
      position: 'absolute',
      top: '0',
      bottom: '12px', // matches the bar's bottom padding — fade covers pill height only
      right: '0',
      width: '52px',
      borderRadius: '0 0 0 16px',
      background: 'linear-gradient(90deg, rgba(13,16,21,0) 0%, rgba(13,16,21,0.92) 78%)',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 120ms ease-out',
    });
    const updateFade = () => {
      const more = bar.scrollWidth - bar.clientWidth - bar.scrollLeft > 4;
      fade.style.opacity = more ? '1' : '0';
    };
    bar.addEventListener('scroll', updateFade, { passive: true });

    this.tabButtons = new Map();
    const fullLabels = new Map(TABS.map(([key, label]) => [key, label]));
    const shortLabels = new Map(TABS.map(([key, , short]) => [key, short]));
    for (const [key, label] of TABS) {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        flex: '1 0 auto',
        minHeight: '44px', // touch-target floor
        borderRadius: '16px',
        border: 'none',
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      });
      b.addEventListener('click', () => this.#selectTab(key));
      bar.appendChild(b);
      this.tabButtons.set(key, b);
    }
    barWrap.append(bar, fade);
    parent.appendChild(barWrap);

    const COMPACT_STEPS = [
      { font: 13, padX: 10, gap: 9, barPadX: 24, short: false },
      { font: 12, padX: 8, gap: 7, barPadX: 16, short: false },
      { font: 12, padX: 8, gap: 7, barPadX: 16, short: true },
      { font: 11, padX: 6, gap: 6, barPadX: 12, short: true },
    ];
    const WIDE = { font: 14, padX: 8, gap: 9, barPadX: 24, short: false };
    const applyStep = (s) => {
      bar.style.gap = `${s.gap}px`;
      bar.style.padding = `0 ${s.barPadX}px 12px`;
      for (const [key, b] of this.tabButtons) {
        b.style.padding = s === WIDE ? `12px ${s.padX}px` : `10px ${s.padX}px`;
        b.style.fontSize = `${s.font}px`;
        b.textContent = (s.short ? shortLabels : fullLabels).get(key);
      }
    };
    const applySizing = () => {
      if (window.innerWidth >= settings.ui.menuTabBreakpoint) {
        applyStep(WIDE);
      } else {
        for (const step of COMPACT_STEPS) {
          applyStep(step);
          if (bar.scrollWidth <= bar.clientWidth + 1) break; // fits — keep the loosest step that does
        }
      }
      updateFade();
    };
    applySizing();
    window.addEventListener('resize', applySizing);
    this._applyTabSizing = applySizing;

    this.#styleTabs();
  }

  #selectTab(key) {
    if (this.activeTab === key) return;
    this.activeTab = key;
    this.#styleTabs();
    if (this.isOpen) this.update(this.state); // the signature includes the tab → rebuilds now
  }

  #styleTabs() {
    for (const [key, b] of this.tabButtons) {
      Object.assign(b.style, key === this.activeTab ? TAB_ACTIVE : TAB_INACTIVE);
    }
  }

  open() {
    this.isOpen = true;
    this.panel.style.display = 'flex';
    this.update(this.state);
    this._applyTabSizing?.(); // re-measure pill fit (and fade) now that scrollWidth is real
  }

  close() {
    this.isOpen = false;
    this.panel.style.display = 'none';
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

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

  #rebuild(model) {
    this.content.replaceChildren();
    this.rowEls.clear();
    this.adRepLine = null; // recreated below only while the Advertising tab is up

    if (this.activeTab === 'garage') {
      this.content.appendChild(this.#sectionHeader('Automation'));
      this.content.appendChild(this.#card(null, model.automation));
      if (model.garageBreaks.length > 0) {
        this.content.appendChild(this.#sectionHeader('Breaks'));
        this.content.appendChild(this.#card(null, model.garageBreaks));
      }
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
        if (model.gasBreaks.length > 0) {
          this.content.appendChild(this.#sectionHeader('Breaks'));
          this.content.appendChild(this.#card(null, model.gasBreaks));
        }
        this.content.appendChild(this.#sectionHeader('Attendants'));
        const grid = this.#cardGrid();
        for (const attendant of model.attendants) grid.appendChild(this.#card(attendant.title, attendant.rows));
        this.content.appendChild(grid);
      } else {
        this.content.appendChild(this.#placeholder('Open the gas station and hire attendants to unlock these upgrades.'));
      }
    } else if (this.activeTab === 'player') {
      this.content.appendChild(this.#sectionHeader('Player'));
      this.content.appendChild(this.#card(null, model.player));
    } else {
      this.content.appendChild(this.#sectionHeader('Advertising'));
      this.content.appendChild(this.#buildAdvertising());
    }

    this.#refresh(model);
  }

  #cardGrid() {
    const grid = document.createElement('div');
    Object.assign(grid.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' });
    return grid;
  }

  #placeholder(text) {
    const p = document.createElement('div');
    p.textContent = text;
    Object.assign(p.style, {
      background: 'rgba(255,255,255,0.03)',
      border: '1px dashed rgba(159,176,192,0.3)',
      borderRadius: '22px',
      padding: '20px 16px',
      marginTop: '14px',
      fontSize: '13px',
      fontWeight: '600',
      color: '#8b96a3',
      textAlign: 'center',
    });
    return p;
  }

  #buildAdvertising() {
    const card = document.createElement('div');
    Object.assign(card.style, CARD_CHROME);

    this.adRepLine = document.createElement('div');
    Object.assign(this.adRepLine.style, {
      fontSize: '14px',
      fontWeight: '700',
      color: '#eef2f6',
      marginBottom: '4px',
    });

    const gates = settings.pit.unlockReputation
      .filter((r) => r > 0)
      .map((r) => `${Math.round(r * 100)}`)
      .join('/');
    const blurb = document.createElement('div');
    blurb.textContent =
      `A better reputation attracts fancier cars that pay far more — and buying new pit lots requires it (${gates}%).`;
    Object.assign(blurb.style, {
      fontSize: '12px',
      fontWeight: '600',
      color: '#9fb0c0',
      lineHeight: '1.45',
      marginBottom: '10px',
    });
    this.adBlurb = blurb;

    this.adBoostLine = document.createElement('div');
    Object.assign(this.adBoostLine.style, {
      fontSize: '12px',
      fontWeight: '600',
      color: '#f0c14b',
      minHeight: '15px',
      marginBottom: '10px',
    });

    this.adBuyBtn = this.#adButton();
    this.adBuyBtn.addEventListener('click', () => {
      if (buyAdvertising(this.state)) {
        this.update(this.state);
        saveGame(this.state);
      }
    });

    this.adWatchBtn = this.#adButton();
    this.adWatchBtn.addEventListener('click', () => {
      if (getReputationMenuModel(this.state).watchDisabled) return;
      showRewardedAd(
        () => {
          watchAdForReputation(this.state);
          this.update(this.state);
          saveGame(this.state);
        },
        () => this.update(this.state)
      );
    });

    card.append(this.adRepLine, this.adBlurb, this.adBoostLine, this.adBuyBtn, this.adWatchBtn);
    return card;
  }

  #adButton() {
    const b = document.createElement('button');
    b.className = 'um-cost';
    Object.assign(b.style, {
      width: '100%',
      padding: '11px 12px',
      minHeight: '44px', // touch-target floor
      borderRadius: '13px',
      border: 'none',
      fontWeight: '800',
      fontSize: '14px',
      fontFamily: 'inherit',
      cursor: 'pointer',
      marginBottom: '8px',
    });
    return b;
  }

  #sectionHeader(text) {
    const h = document.createElement('div');
    h.textContent = text.toUpperCase();
    Object.assign(h.style, {
      fontSize: '15px',
      fontWeight: '800',
      letterSpacing: '1.5px',
      color: '#f4f7fa',
      margin: '14px 4px 12px',
    });
    return h;
  }

  #card(title, rows) {
    const card = document.createElement('div');
    Object.assign(card.style, CARD_CHROME);

    if (title) {
      const heading = document.createElement('div');
      Object.assign(heading.style, { display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '12px' });
      const chip = document.createElement('div');
      chip.textContent = chipLabel(title);
      Object.assign(chip.style, {
        width: '26px',
        height: '26px',
        borderRadius: '9px',
        background: 'linear-gradient(160deg,#333d4a,#222a34)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontWeight: '900',
        color: '#c7d2dc',
        flexShrink: '0',
      });
      const name = document.createElement('span');
      name.textContent = title;
      Object.assign(name.style, { color: '#f4f7fa', fontSize: '16px', fontWeight: '800' });
      heading.append(chip, name);
      card.appendChild(heading);
    }

    for (const row of rows) card.appendChild(this.#row(row));
    return card;
  }

  #row(row) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      padding: '8px 0',
    });

    const left = document.createElement('div');
    left.style.minWidth = '0';

    const label = document.createElement('div');
    label.textContent = row.label;
    Object.assign(label.style, { fontSize: '14px', fontWeight: '700', color: '#eef2f6' });

    const effect = document.createElement('div');
    Object.assign(effect.style, {
      fontSize: '12px',
      fontWeight: '600',
      color: '#9fb0c0',
      marginTop: '2px',
      minHeight: '15px',
    });
    left.append(label, effect);

    const button = document.createElement('button');
    button.className = 'um-cost';
    Object.assign(button.style, { flexShrink: '0', border: 'none', fontFamily: 'inherit', whiteSpace: 'nowrap' });
    button.addEventListener('click', () => this.#buy(row.kind, row.pitIndex));

    wrap.append(left, button);
    this.rowEls.set(rowKey(row), { wrap, label, effect, button });
    return wrap;
  }

  #refresh(model) {
    for (const row of model.automation) this.#refreshRow(row);
    for (const row of model.garageBreaks) this.#refreshRow(row);
    for (const row of model.gasBreaks) this.#refreshRow(row);
    for (const row of model.supermarket) this.#refreshRow(row);
    for (const row of model.player) this.#refreshRow(row);
    for (const worker of model.workers) for (const row of worker.rows) this.#refreshRow(row);
    for (const attendant of model.attendants) for (const row of attendant.rows) this.#refreshRow(row);
    this.#refreshAdvertising();
  }

  #refreshAdvertising() {
    if (!this.adRepLine) return;
    const m = getReputationMenuModel(this.state);

    this.adRepLine.textContent = `Reputation: ${m.permanentPct}%`;
    this.adBoostLine.textContent = m.watchOnCooldown
      ? `Next free ad in ${mmss(m.watchCooldownRemaining)}`
      : '';

    this.adBuyBtn.textContent = m.atCap
      ? 'Reputation MAXED'
      : `Buy Advertising (+${Math.round(settings.reputation.repStep * 100)}%) — ${m.adCostLabel}`;
    setAdButton(this.adBuyBtn, m.adDisabled);

    if (m.atCap) {
      this.adWatchBtn.textContent = 'Reputation MAXED';
      setAdButton(this.adWatchBtn, true);
    } else if (m.watchOnCooldown) {
      this.adWatchBtn.textContent = `Watch Ad — ${mmss(m.watchCooldownRemaining)}`;
      setAdButton(this.adWatchBtn, true);
    } else {
      this.adWatchBtn.textContent = `Watch Ad (+${m.watchRewardPct}% reputation)`;
      setAdButton(this.adWatchBtn, false);
    }
  }

  #refreshRow(row) {
    const el = this.rowEls.get(rowKey(row));
    if (!el) return;
    setEffectText(el.effect, row.effect);
    el.button.textContent = row.cost;
    el.button.disabled = row.disabled;

    const locked = row.cost === 'LOCKED';
    el.wrap.style.opacity = locked ? '0.5' : '1';
    el.label.style.color = locked ? '#c7d2dc' : '#eef2f6';
    el.effect.style.color = locked ? '#8b96a3' : '#9fb0c0';

    if (!row.disabled) styleCostButton(el.button, false);
    else if (row.cost === 'OWNED') styleBadge(el.button, '#3ad06a', 'rgba(58,208,106,0.15)');
    else if (row.cost === 'MAX') styleBadge(el.button, '#f0c14b', 'rgba(240,193,75,0.15)');
    else if (row.cost.startsWith('$')) styleCostButton(el.button, true);
    else styleBadge(el.button, '#8b96a3', '#3a434f');
  }

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
      case 'truckFrequency':
        ok = buyTruckFrequency(this.state);
        break;
      case 'orderTruck':
        ok = orderTruck(this.state); // free: places the delivery order, no cash involved
        break;
      case 'attendantSpeed':
        ok = buyAttendantSpeed(this.state, pitIndex);
        break;
      case 'mechanicBreak':
        ok = buyBreakDuration(this.state, 'carMechanic');
        break;
      case 'marketBreak':
        ok = buyBreakDuration(this.state, 'marketWorker');
        break;
      case 'attendantBreak':
        ok = buyBreakDuration(this.state, 'gasAttendant');
        break;
      case 'mechanicShift':
        ok = buyBreakThreshold(this.state, 'carMechanic');
        break;
      case 'marketShift':
        ok = buyBreakThreshold(this.state, 'marketWorker');
        break;
      case 'attendantShift':
        ok = buyBreakThreshold(this.state, 'gasAttendant');
        break;
      case 'playerSpeed':
        ok = buyPlayerSpeed(this.state);
        break;
    }
    if (ok) {
      this.update(this.state);
      saveGame(this.state);
    }
  }
}

const FONT = settings.ui.fontStack;

const TAB_ACTIVE = {
  fontWeight: '800',
  color: '#10131a',
  background: 'linear-gradient(180deg,#dfe1de,#c2c6c0)',
  boxShadow: '0 8px 20px -6px rgba(0,0,0,0.5), inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -3px 0 rgba(120,130,140,0.3)',
};

const TAB_INACTIVE = {
  fontWeight: '700',
  color: '#9fb0c0',
  background: 'linear-gradient(180deg,#212934,#1a212a)',
  boxShadow: '0 4px 10px -4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
};

const CARD_CHROME = {
  borderRadius: '22px',
  padding: '16px 16px 8px',
  background: 'linear-gradient(180deg,#212a35,#181e27)',
  boxShadow: '0 12px 28px -14px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)',
};

function styleCostButton(btn, dimmed) {
  Object.assign(btn.style, {
    padding: '9px 17px',
    minHeight: '44px', // touch-target floor
    borderRadius: '13px',
    fontSize: '14px',
    fontWeight: '800',
    letterSpacing: '0',
    color: '#062611',
    background: 'linear-gradient(180deg,#4ee383,#2eb95c)',
    boxShadow: '0 6px 14px -5px rgba(58,208,106,0.6), inset 0 2px 0 rgba(255,255,255,0.4), inset 0 -3px 0 rgba(0,80,30,0.35)',
    cursor: dimmed ? 'default' : 'pointer',
    opacity: dimmed ? '0.45' : '1',
  });
}

function styleBadge(btn, color, background) {
  Object.assign(btn.style, {
    padding: '8px 14px',
    minHeight: '44px',
    borderRadius: '13px',
    fontSize: '12px',
    fontWeight: '900',
    letterSpacing: '0.8px',
    color,
    background,
    boxShadow: 'none',
    cursor: 'default',
    opacity: '1',
  });
}

function setAdButton(btn, disabled) {
  btn.disabled = disabled;
  if (disabled) {
    Object.assign(btn.style, {
      background: '#3a434f',
      color: '#8b96a3',
      boxShadow: 'none',
      cursor: 'default',
      opacity: '0.7',
    });
  } else {
    Object.assign(btn.style, {
      background: 'linear-gradient(180deg,#4ee383,#2eb95c)',
      color: '#062611',
      boxShadow: '0 6px 14px -5px rgba(58,208,106,0.6), inset 0 2px 0 rgba(255,255,255,0.4), inset 0 -3px 0 rgba(0,80,30,0.35)',
      cursor: 'pointer',
      opacity: '1',
    });
  }
}

function setEffectText(el, text) {
  if (el.dataset.effect === text) return;
  el.dataset.effect = text;
  el.replaceChildren();
  const parts = text.split('→');
  parts.forEach((part, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.textContent = '→';
      arrow.style.color = '#3ad06a';
      el.appendChild(arrow);
    }
    el.appendChild(document.createTextNode(part));
  });
}

function chipLabel(title) {
  const last = title.trim().split(/\s+/).pop();
  return (last.length <= 2 ? last : title.trim()[0]).toUpperCase();
}

function buildStatusBar() {
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '9px 26px 3px',
    flexShrink: '0',
    position: 'relative',
    zIndex: '6',
  });

  const clock = document.createElement('span');
  clock.textContent = '9:41';
  Object.assign(clock.style, {
    color: '#c7d2dc',
    fontSize: '13px',
    fontWeight: '800',
    letterSpacing: '0.5px',
    fontVariantNumeric: 'tabular-nums',
  });

  const right = document.createElement('div');
  Object.assign(right.style, { display: 'flex', alignItems: 'center', gap: '8px' });

  const signal = document.createElement('div');
  Object.assign(signal.style, { display: 'flex', alignItems: 'flex-end', gap: '2px', height: '11px' });
  for (const h of [4, 6, 8, 11]) {
    const s = document.createElement('span');
    Object.assign(s.style, { width: '3px', height: `${h}px`, borderRadius: '1px', background: '#c7d2dc' });
    signal.appendChild(s);
  }

  const net = document.createElement('span');
  net.textContent = '5G';
  Object.assign(net.style, { color: '#c7d2dc', fontSize: '12px', fontWeight: '800', letterSpacing: '0.3px' });

  const battery = document.createElement('div');
  Object.assign(battery.style, { display: 'flex', alignItems: 'center', gap: '2px' });
  const shell = document.createElement('div');
  Object.assign(shell.style, {
    width: '23px',
    height: '12px',
    borderRadius: '3px',
    boxShadow: 'inset 0 0 0 1.5px rgba(199,210,220,0.8)',
    padding: '2px',
  });
  const fill = document.createElement('div');
  Object.assign(fill.style, { width: '72%', height: '100%', borderRadius: '1px', background: '#3ad06a' });
  shell.appendChild(fill);
  const nub = document.createElement('div');
  Object.assign(nub.style, { width: '2px', height: '5px', borderRadius: '0 1px 1px 0', background: 'rgba(199,210,220,0.8)' });
  battery.append(shell, nub);

  right.append(signal, net, battery);
  bar.append(clock, right);
  return bar;
}

let menuStylesInjected = false;
function injectMenuStylesheet() {
  if (menuStylesInjected) return;
  menuStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .um-cost:not(:disabled):active { transform: translateY(2px); filter: brightness(0.95); }
    .um-tabbar::-webkit-scrollbar { display: none; }
    .um-content::-webkit-scrollbar { width: 8px; }
    .um-content::-webkit-scrollbar-thumb { background: rgba(199,210,220,0.18); border-radius: 4px; }
    .um-content::-webkit-scrollbar-track { background: transparent; }
  `;
  document.head.appendChild(style);
}

function rowKey(row) {
  return row.pitIndex === undefined ? row.kind : `${row.kind}:${row.pitIndex}`;
}

function mmss(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function structureSignature(model, activeTab) {
  const automation = model.automation.map(rowKey).join(',');
  const garageBreaks = model.garageBreaks.map(rowKey).join(',');
  const gasBreaks = model.gasBreaks.map(rowKey).join(',');
  const supermarket = model.supermarket.map(rowKey).join(',');
  const player = model.player.map(rowKey).join(',');
  const workers = model.workers.map((w) => `${w.index}:${w.rows.map((r) => r.kind).join('')}`).join('|');
  const attendants = model.attendants.map((w) => `${w.index}:${w.rows.map((r) => r.kind).join('')}`).join('|');
  return `${activeTab}|A[${automation}]B[${garageBreaks}]G[${gasBreaks}]S[${supermarket}]PL[${player}]W[${workers}]P[${attendants}]`;
}
