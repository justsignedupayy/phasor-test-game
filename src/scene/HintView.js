import * as THREE from 'three';
import settings from '../config/settings.js';
import { getHintView } from '../core/hints.js';
import { worldToScreen } from './popup.js';

// Renders core/hints.js views in the tutorial's visual language (pulsing gold
// ground ring + bubble), but on its own ring/bubble so a live tutorial step and
// a hint never fight over the same elements.
export class HintView {
  constructor(sceneManager, menu) {
    this.sm = sceneManager;
    this.menu = menu;
    this.time = 0;

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
      zIndex: '18', // just under the tutorial's bubble (19) — a live step wins visually
    });
    document.body.appendChild(this.bubble);
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
    const view = getHintView(state);

    if (!view || this.menu.isOpen) {
      this.ring.visible = false;
      this.bubble.style.display = 'none';
      return;
    }

    const R = settings.tutorial.ring;
    const anchor = view.anchor;
    this.ring.visible = true;
    this.ring.position.set(anchor.x, 0, anchor.z);
    const pulse = 1 + R.pulseScale * Math.sin(this.time * R.pulseSpeed);
    this.ring.scale.set(pulse, 1, pulse);
    this.ring.children[0].material.opacity = 0.65 + 0.3 * (0.5 + 0.5 * Math.sin(this.time * R.pulseSpeed));

    const dom = this.sm.renderer.domElement;
    const rect = dom.getBoundingClientRect();
    const p = worldToScreen({ x: anchor.x, y: settings.tutorial.labelHeight, z: anchor.z }, this.sm.camera, dom);
    // Clamp on-screen (no edge arrow — the resting worker's LED already pulls the eye there).
    const x = Math.min(Math.max(p.x, rect.left + 145), rect.right - 145);
    const y = Math.min(Math.max(p.y, rect.top + 60), rect.bottom - 40);
    if (this.bubble.textContent !== view.text) this.bubble.textContent = view.text;
    this.bubble.style.display = 'block';
    this.bubble.style.left = `${x}px`;
    this.bubble.style.top = `${y}px`;
    this.bubble.style.transform = 'translate(-50%, -100%)';
  }
}
