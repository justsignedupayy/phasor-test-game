import * as THREE from 'three';
import settings from '../config/settings.js';
import { getTutorialView, dismissTutorialFinale } from '../core/tutorial.js';
import { worldToScreen } from './popup.js';
import { saveGame } from '../platform/storage.js';

export class TutorialView {
  constructor(sceneManager, state, menu, unlockMarkers) {
    this.sm = sceneManager;
    this.state = state;
    this.menu = menu;
    this.unlockMarkers = unlockMarkers;
    this.time = 0;
    this.highlighted = null; // DOM element currently carrying .tut-glow
    this.popupEl = null; // the finale card, once shown

    injectTutorialStylesheet();

    this.ring = this.#buildRing();
    this.ring.visible = false;
    sceneManager.add(this.ring);

    this.bubble = document.createElement('div');
    Object.assign(this.bubble.style, {
      position: 'fixed',
      display: 'none',
      maxWidth: '270px',
      padding: '10px 14px',
      borderRadius: '14px',
      background: 'rgba(16,19,26,0.92)',
      border: '1px solid rgba(255,224,138,0.85)',
      boxShadow: '0 8px 22px rgba(0,0,0,0.55), 0 0 14px rgba(255,224,138,0.35)',
      font: `700 14px ${settings.ui.fontStack}`,
      color: '#ffe08a',
      textAlign: 'center',
      textShadow: '0 1px 0 rgba(0,0,0,0.6)',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '19',
    });
    document.body.appendChild(this.bubble);

    this.arrow = document.createElement('div');
    this.arrow.textContent = '➤';
    Object.assign(this.arrow.style, {
      position: 'fixed',
      display: 'none',
      fontSize: `${settings.tutorial.arrow.size}px`,
      lineHeight: '1',
      color: '#ffe08a',
      textShadow: '0 0 12px rgba(255,224,138,0.95), 0 2px 4px rgba(0,0,0,0.6)',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '19',
      transformOrigin: '50% 50%',
    });
    document.body.appendChild(this.arrow);
  }

  #buildRing() {
    const R = settings.tutorial.ring;
    const group = new THREE.Group();
    const mat = (opacity) =>
      new THREE.MeshBasicMaterial({ color: R.color, transparent: true, opacity, depthWrite: false });
    const inner = new THREE.Mesh(new THREE.RingGeometry(R.radius - R.thickness, R.radius, 48), mat(0.9));
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(R.radius + 0.25, R.radius + 0.25 + R.thickness * 0.5, 48),
      mat(0.35)
    );
    for (const mesh of [inner, outer]) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.03;
      mesh.renderOrder = 2;
      group.add(mesh);
    }
    return group;
  }

  update(dt, state) {
    this.time += dt;
    const view = getTutorialView(state, (kind, index) => this.unlockMarkers.getPaidAmount(kind, index));

    if (!view) {
      this.#hideRing();
      this.#hideBubble();
      this.#hideArrow();
      this.#setHighlight(null);
      this.#removePopup();
      return;
    }

    if (view.anchor.kind === 'popup') {
      this.#hideRing();
      this.#hideBubble();
      this.#hideArrow();
      this.#setHighlight(null);
      this.#showPopup(view.text);
      return;
    }

    const menuBlocksBubble = this.menu.isOpen && view.anchor.kind !== 'tablet';

    if (view.anchor.kind === 'info') {
      this.#hideRing();
      this.#hideArrow();
      this.#setHighlight(null);
      if (menuBlocksBubble) this.#hideBubble();
      else this.#showBubble(view.text, window.innerWidth / 2, 78, 'translate(-50%, 0)');
      return;
    }

    if (view.anchor.kind === 'world') {
      this.#setHighlight(null);
      if (menuBlocksBubble) {
        this.#hideRing();
        this.#hideArrow();
        this.#hideBubble();
      } else {
        this.#placeWorldAnchor(view.anchor, view.text, state);
      }
      return;
    }

    this.#hideRing();
    const el = this.#resolveTabletElement(view.anchor);
    this.#setHighlight(el);
    this.#placeBubbleAtElement(el, view.text);
    if (!this.menu.isOpen && el) this.#placeButtonArrow(el);
    else this.#hideArrow();
  }

  #placeWorldAnchor(anchor, text, state) {
    const A = settings.tutorial.arrow;
    const dom = this.sm.renderer.domElement;
    const rect = dom.getBoundingClientRect();
    const p = worldToScreen({ x: anchor.x, y: 0.5, z: anchor.z }, this.sm.camera, dom);

    const m = A.edgeMargin;
    const onScreen =
      p.x >= rect.left + m && p.x <= rect.right - m && p.y >= rect.top + m && p.y <= rect.bottom - m;

    if (onScreen) {
      this.#hideArrow();
      this.#placeRing(anchor);
      const bp = worldToScreen(
        { x: anchor.x, y: anchor.y ?? settings.tutorial.labelHeight, z: anchor.z },
        this.sm.camera,
        dom
      );
      const bx = Math.min(Math.max(bp.x, 145), window.innerWidth - 145);
      let by = bp.y;
      const pp = state?.player?.position;
      if (pp) {
        const head = worldToScreen(
          { x: pp.x, y: settings.character.headHeight, z: pp.z },
          this.sm.camera,
          dom
        );
        const overlapX = Math.abs(bx - head.x) < 145; // half the bubble's 270px maxWidth
        const minBottom = head.y - settings.tutorial.bubblePlayerClearance;
        if (overlapX && by > minBottom) by = Math.max(minBottom, rect.top + 40);
      }
      this.#showBubble(text, bx, by, 'translate(-50%, -100%)');
      return;
    }

    this.ring.visible = false; // out of view anyway — keep the scene clean
    const cx = Math.min(Math.max(p.x, rect.left + m), rect.right - m);
    const cy = Math.min(Math.max(p.y, rect.top + m), rect.bottom - m);
    const angle = Math.atan2(p.y - cy, p.x - cx);
    const bounce = Math.sin(this.time * 5) * 6;
    const ax = cx + Math.cos(angle) * bounce;
    const ay = cy + Math.sin(angle) * bounce;
    this.arrow.style.display = 'block';
    this.arrow.style.left = `${ax}px`;
    this.arrow.style.top = `${ay}px`;
    this.arrow.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;

    const bx = Math.min(Math.max(cx - Math.cos(angle) * 150, rect.left + 145), rect.right - 145);
    const by = Math.min(Math.max(cy - Math.sin(angle) * 90, rect.top + 40), rect.bottom - 60);
    this.#showBubble(text, bx, by, 'translate(-50%, -50%)');
  }

  #placeRing(anchor) {
    const R = settings.tutorial.ring;
    this.ring.visible = true;
    this.ring.position.set(anchor.x, 0, anchor.z);
    const pulse = 1 + R.pulseScale * Math.sin(this.time * R.pulseSpeed);
    this.ring.scale.set(pulse, 1, pulse);
    const glow = 0.65 + 0.3 * (0.5 + 0.5 * Math.sin(this.time * R.pulseSpeed));
    this.ring.children[0].material.opacity = glow;
  }

  #hideRing() {
    this.ring.visible = false;
  }

  #hideArrow() {
    this.arrow.style.display = 'none';
  }

  #resolveTabletElement(anchor) {
    const menu = this.menu;
    if (!menu.isOpen) return menu.button;
    if (menu.activeTab !== anchor.tab) return menu.tabButtons.get(anchor.tab) ?? menu.button;
    if (anchor.element === 'watchAd') return menu.adWatchBtn ?? menu.button;
    const row = menu.rowEls.get(anchor.element);
    return row?.wrap ?? menu.tabButtons.get(anchor.tab) ?? menu.button;
  }

  #placeButtonArrow(el) {
    const rect = el.getBoundingClientRect();
    const bounce = Math.sin(this.time * 5) * 7;
    this.arrow.style.display = 'block';
    this.arrow.style.left = `${rect.left + rect.width / 2}px`;
    this.arrow.style.top = `${rect.bottom + settings.tutorial.arrow.buttonGap + bounce}px`;
    this.arrow.style.transform = 'translate(-50%, -50%) rotate(-90deg)'; // '➤' points right → up
  }

  #setHighlight(el) {
    if (this.highlighted === el) return;
    if (this.highlighted) this.highlighted.classList.remove('tut-glow');
    this.highlighted = el;
    if (el) el.classList.add('tut-glow');
  }

  #placeBubbleAtElement(el, text) {
    if (!el) {
      this.#hideBubble();
      return;
    }
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(rect.left + rect.width / 2, 145), window.innerWidth - 145);
    const gap = this.menu.isOpen ? 10 : settings.tutorial.arrow.buttonGap + 34;
    this.#showBubble(text, x, rect.bottom + gap, 'translate(-50%, 0)');
  }

  #showBubble(text, x, y, transform) {
    if (this.bubble.textContent !== text) this.bubble.textContent = text;
    this.bubble.style.display = 'block';
    this.bubble.style.left = `${x}px`;
    this.bubble.style.top = `${y}px`;
    this.bubble.style.transform = transform;
  }

  #hideBubble() {
    this.bubble.style.display = 'none';
  }

  #showPopup(text) {
    if (this.popupEl) return; // already up — core's timer (or a tap) takes it down
    const card = document.createElement('div');
    Object.assign(card.style, {
      position: 'fixed',
      top: '38%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      maxWidth: 'min(420px, 84vw)',
      padding: '22px 26px',
      borderRadius: '20px',
      background: 'rgba(16,19,26,0.95)',
      border: '1px solid rgba(255,224,138,0.9)',
      boxShadow: '0 18px 50px rgba(0,0,0,0.65), 0 0 26px rgba(255,224,138,0.4)',
      font: `800 17px ${settings.ui.fontStack}`,
      color: '#ffe08a',
      textAlign: 'center',
      textShadow: '0 1px 0 rgba(0,0,0,0.6)',
      cursor: 'pointer',
      userSelect: 'none',
      zIndex: '30',
    });
    card.textContent = text;

    const hint = document.createElement('div');
    hint.textContent = 'Tap to continue';
    Object.assign(hint.style, {
      marginTop: '12px',
      font: `700 12px ${settings.ui.fontStack}`,
      color: '#9fb0c0',
    });
    card.appendChild(hint);

    card.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); // never let the dismiss tap spawn the joystick
      dismissTutorialFinale(this.state);
      saveGame(this.state); // the tutorial's done flag is worth persisting immediately
      this.#removePopup();
    });

    document.body.appendChild(card);
    this.popupEl = card;
  }

  #removePopup() {
    if (!this.popupEl) return;
    this.popupEl.remove();
    this.popupEl = null;
  }
}

let tutorialStylesInjected = false;
function injectTutorialStylesheet() {
  if (tutorialStylesInjected) return;
  tutorialStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .tut-glow {
      border-radius: 14px;
      animation: tutGlowPulse 1.2s ease-in-out infinite;
    }
    @keyframes tutGlowPulse {
      0%, 100% { box-shadow: 0 0 0 3px #ffe08a, 0 0 14px 4px rgba(255,224,138,0.5); }
      50% { box-shadow: 0 0 0 4px #ffe08a, 0 0 26px 10px rgba(255,224,138,0.85); }
    }
  `;
  document.head.appendChild(style);
}
