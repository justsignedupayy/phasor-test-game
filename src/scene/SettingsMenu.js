import settings from '../config/settings.js';
import { getMusicVolume, setMusicVolume, isMuted, setMuted } from '../platform/audio.js';

/**
 * SettingsMenu — a second hanging tab at the top-left, sitting just right of
 * the Upgrades tab and dressed identically (design direction 1c "Tablet
 * handle / tab"), opening a small centered panel styled to match TruckMenu /
 * BreakMenu. It holds the music volume slider plus a global mute toggle
 * beside it (silences ALL audio — music, ambience and one-shots — restoring
 * the remembered levels on unmute), both applied live through
 * platform/audio.js (which also persists them across sessions).
 */
export class SettingsMenu {
  constructor() {
    this.isOpen = false;
    this.#buildButton();
    this.#buildPanel();
  }

  #buildButton() {
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      position: 'fixed',
      top: 'env(safe-area-inset-top, 0px)',
      left: '164px', // clears the Upgrades tab (left: 22px, ~132px wide)
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
      border: '1px solid rgba(143,211,255,0.45)',
      boxShadow: '0 0 10px rgba(143,211,255,0.45)',
    });

    // Gear glyph: hub circle + eight spokes, same stroke treatment as the
    // Upgrades arrow but in the HUD's info blue instead of cash green.
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.style.filter = 'drop-shadow(0 0 3px rgba(143,211,255,0.75))';
    const hub = document.createElementNS(svgNS, 'circle');
    hub.setAttribute('cx', '12');
    hub.setAttribute('cy', '12');
    hub.setAttribute('r', '3.4');
    hub.setAttribute('stroke', '#8fd3ff');
    hub.setAttribute('stroke-width', '2.4');
    const spokes = document.createElementNS(svgNS, 'path');
    spokes.setAttribute(
      'd',
      'M12 3.5v3.2 M12 17.3v3.2 M3.5 12h3.2 M17.3 12h3.2 M6 6l2.3 2.3 M15.7 15.7L18 18 M18 6l-2.3 2.3 M8.3 15.7L6 18'
    );
    spokes.setAttribute('stroke', '#8fd3ff');
    spokes.setAttribute('stroke-width', '2.4');
    spokes.setAttribute('stroke-linecap', 'round');
    svg.append(hub, spokes);
    iconTile.appendChild(svg);

    const label = document.createElement('span');
    label.textContent = 'Settings';
    Object.assign(label.style, {
      fontFamily: settings.ui.fontStack,
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
    heading.textContent = 'Settings';
    Object.assign(heading.style, { fontWeight: '800', fontSize: '17px' });
    panel.appendChild(heading);

    const labelRow = document.createElement('div');
    Object.assign(labelRow.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      fontSize: '14px',
      color: '#9fb0c0',
    });
    const labelText = document.createElement('span');
    labelText.textContent = 'Music Volume';
    const valueText = document.createElement('span');
    Object.assign(valueText.style, { fontWeight: '800', color: '#8fd3ff' });
    labelRow.append(labelText, valueText);
    panel.appendChild(labelRow);

    // The volume row: the slider with the global mute toggle beside it.
    const sliderRow = document.createElement('div');
    Object.assign(sliderRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    });

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    Object.assign(slider.style, {
      flex: '1',
      minWidth: '0',
      margin: '0',
      accentColor: '#8fd3ff',
      cursor: 'pointer',
    });
    slider.addEventListener('input', () => {
      setMusicVolume(slider.value / 100); // applies live (unless muted) + persists
      valueText.textContent = `${slider.value}%`;
    });

    // Global mute: one tap silences ALL audio (music, ambience, one-shot
    // effects — see platform/audio.setMuted); tapping again restores the
    // remembered levels. Persisted like the volume.
    const muteBtn = document.createElement('button');
    Object.assign(muteBtn.style, {
      flexShrink: '0',
      width: '32px',
      height: '32px',
      borderRadius: '6px',
      border: 'none',
      background: '#3a434f',
      fontSize: '16px',
      lineHeight: '1',
      cursor: 'pointer',
      WebkitTapHighlightColor: 'transparent',
    });
    muteBtn.addEventListener('click', () => {
      setMuted(!isMuted()); // applies instantly + persists
      this.#refreshMuteButton();
    });

    sliderRow.append(slider, muteBtn);
    panel.appendChild(sliderRow);

    document.body.appendChild(panel);
    this.panel = panel;
    this.slider = slider;
    this.valueText = valueText;
    this.muteBtn = muteBtn;
    this.#refreshMuteButton();
  }

  // Sync the mute button's icon/tint (and dim the slider) to the live state.
  #refreshMuteButton() {
    const muted = isMuted();
    this.muteBtn.textContent = muted ? '🔇' : '🔊';
    this.muteBtn.title = muted ? 'Unmute all audio' : 'Mute all audio';
    this.muteBtn.style.background = muted ? '#5a2f33' : '#3a434f';
    this.slider.style.opacity = muted ? '0.45' : '1';
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    // Re-read on every open — the persisted values are the source of truth.
    const pct = Math.round(getMusicVolume() * 100);
    this.slider.value = String(pct);
    this.valueText.textContent = `${pct}%`;
    this.#refreshMuteButton();
    this.panel.style.display = 'flex';
  }

  close() {
    this.isOpen = false;
    this.panel.style.display = 'none';
  }
}
