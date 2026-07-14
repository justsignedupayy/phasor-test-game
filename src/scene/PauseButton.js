import settings from '../config/settings.js';

export class PauseControl {
  constructor(setPaused) {
    this.setPaused = setPaused;
    this.#buildButton();
    this.#buildOverlay();
  }

  #buildButton() {
    const btn = document.createElement('button');
    btn.title = 'Pause';
    Object.assign(btn.style, {
      position: 'fixed',
      top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
      right: '14px',
      width: '44px',
      height: '44px',
      borderRadius: '10px',
      border: '1px solid #4d5865',
      background: 'linear-gradient(180deg, #3c4551 0%, #333c47 100%)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 6px rgba(0,0,0,0.4)',
      cursor: 'pointer',
      zIndex: '17',
      WebkitTapHighlightColor: 'transparent',
    });

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.style.verticalAlign = 'middle';
    for (const x of [8, 16]) {
      const bar = document.createElementNS(svgNS, 'line');
      bar.setAttribute('x1', String(x));
      bar.setAttribute('x2', String(x));
      bar.setAttribute('y1', '5');
      bar.setAttribute('y2', '19');
      bar.setAttribute('stroke', '#eaf1f7');
      bar.setAttribute('stroke-width', '4');
      bar.setAttribute('stroke-linecap', 'round');
      svg.appendChild(bar);
    }
    btn.appendChild(svg);

    btn.addEventListener('click', () => this.setPaused(true));
    document.body.appendChild(btn);
    this.button = btn;
  }

  #buildOverlay() {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(8, 11, 15, 0.6)',
      zIndex: '30', // above every menu/popup layer — swallows all input while up
      userSelect: 'none',
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '14px',
      padding: '22px 30px',
      background: 'rgba(18,22,28,0.92)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '12px',
      color: '#e7ecf2',
      fontFamily: settings.ui.fontStack,
    });

    const heading = document.createElement('div');
    heading.textContent = 'Paused';
    Object.assign(heading.style, { fontWeight: '800', fontSize: '22px' });

    const resume = document.createElement('button');
    resume.textContent = '▶ RESUME';
    Object.assign(resume.style, {
      padding: '12px 26px',
      borderRadius: '10px',
      border: 'none',
      background: '#27ae60',
      color: '#fff',
      fontWeight: '800',
      fontSize: '16px',
      fontFamily: settings.ui.fontStack,
      cursor: 'pointer',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
    });

    panel.append(heading, resume);
    overlay.appendChild(panel);

    panel.addEventListener('click', (e) => e.stopPropagation());
    resume.addEventListener('click', () => this.setPaused(false));
    overlay.addEventListener('click', () => this.setPaused(false));

    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  sync(paused) {
    this.overlay.style.display = paused ? 'flex' : 'none';
  }
}
