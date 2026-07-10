import * as THREE from 'three';
import settings from '../config/settings.js';
import { getTutorialView, dismissTutorialFinale } from '../core/tutorial.js';
import { worldToScreen } from './popup.js';
import { saveGame } from '../platform/storage.js';

/**
 * TutorialView — renders core/tutorial.js's view model: a pulsing glow ring on
 * the current step's world target (or a CSS glow on a tablet UI element) plus
 * a short instruction bubble beside it, the "earn $X more" info banner for
 * still-gated steps, and the one-time finale popup. Pure render layer: it
 * reads the view model each frame and only ever mutates core through
 * dismissTutorialFinale (the popup tap).
 *
 * World anchors: the ring mesh sits on the ground at the target; the bubble is
 * a fixed-position DOM card placed via worldToScreen every frame (same pattern
 * as popup.js), so it tracks the camera. When the target is OUTSIDE the
 * visible viewport, a directional arrow appears at the screen edge instead,
 * pointing toward it (tracking as the player moves) — the ring/bubble return
 * the moment the target comes back on screen.
 *
 * Tablet anchors resolve against the UpgradeMenu live: closed → its handle
 * button (with a bouncing "open me" arrow under it, so the cue can't be
 * missed), open on the wrong tab → that tab's button, right tab → the specific
 * row/button — the glow walks the player through opening the right screen
 * without any extra state.
 */
export class TutorialView {
  constructor(sceneManager, state, menu) {
    this.sm = sceneManager;
    this.state = state;
    this.menu = menu;
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

    // The directional arrow: doubles as the screen-edge pointer toward an
    // off-screen world target AND the "open the tablet" nudge under the
    // Upgrades handle. One element — the two uses never coexist.
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

  /** Two concentric flat rings on the ground, pulsing in scale + opacity. */
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
      // Above every painted floor decal AND the unlock-marker circles (0.02).
      mesh.position.y = 0.03;
      mesh.renderOrder = 2;
      group.add(mesh);
    }
    return group;
  }

  update(dt, state) {
    this.time += dt;
    const view = getTutorialView(state);

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

    if (view.anchor.kind === 'info') {
      // The waiting banner ("Earn $X more to …"): no highlight anywhere, just
      // a live line of text top-centre, under the cash counter.
      this.#hideRing();
      this.#hideArrow();
      this.#setHighlight(null);
      this.#showBubble(view.text, window.innerWidth / 2, 78, 'translate(-50%, 0)');
      return;
    }

    if (view.anchor.kind === 'world') {
      this.#setHighlight(null);
      this.#placeWorldAnchor(view.anchor, view.text);
      return;
    }

    // Tablet anchor: glow the next DOM element on the way to the target, with
    // the bouncing nudge arrow while the tablet still has to be OPENED.
    this.#hideRing();
    const el = this.#resolveTabletElement(view.anchor);
    this.#setHighlight(el);
    this.#placeBubbleAtElement(el, view.text);
    if (!this.menu.isOpen && el) this.#placeButtonArrow(el);
    else this.#hideArrow();
  }

  // --- world-anchor pieces ---------------------------------------------------

  /**
   * On-screen target → pulsing ground ring + bubble over it. Off-screen target
   * → a directional arrow clamped to the viewport edge, pointing at it, with
   * the bubble tucked inward beside it so the player knows what they're
   * walking toward.
   */
  #placeWorldAnchor(anchor, text) {
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
      this.#showBubble(text, bp.x, bp.y, 'translate(-50%, -100%)');
      return;
    }

    // Clamp the projected point to the edge margins; the arrow points from its
    // clamped spot toward the true (off-screen) position, bouncing along that
    // direction so it reads as "go this way".
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

    // Bubble sits inward of the arrow (toward screen centre), clamped so a
    // corner arrow never pushes it off screen.
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

  // --- tablet-anchor pieces ----------------------------------------------------

  /**
   * The DOM element the glow should sit on for a tablet target, resolved
   * against the menu's live state: its handle while closed, the target tab's
   * button while on another tab, then the actual row/button.
   */
  #resolveTabletElement(anchor) {
    const menu = this.menu;
    if (!menu.isOpen) return menu.button;
    if (menu.activeTab !== anchor.tab) return menu.tabButtons.get(anchor.tab) ?? menu.button;
    if (anchor.element === 'watchAd') return menu.adWatchBtn ?? menu.button;
    const row = menu.rowEls.get(anchor.element);
    return row?.wrap ?? menu.tabButtons.get(anchor.tab) ?? menu.button;
  }

  /** The bouncing "open me" arrow under the Upgrades handle, pointing up at it. */
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
    // Below the element, clamped inside the viewport horizontally.
    const x = Math.min(Math.max(rect.left + rect.width / 2, 145), window.innerWidth - 145);
    // Leave room for the nudge arrow while the tablet is still closed.
    const gap = this.menu.isOpen ? 10 : settings.tutorial.arrow.buttonGap + 34;
    this.#showBubble(text, x, rect.bottom + gap, 'translate(-50%, 0)');
  }

  // --- shared bubble -------------------------------------------------------------

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

  // --- finale popup ----------------------------------------------------------------

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

// The pulsing glow outline for tablet UI targets — CSS animation, injected once
// (same pattern as UpgradeMenu's stylesheet).
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
