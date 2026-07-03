import * as THREE from 'three';
import settings from '../config/settings.js';
import { getUnlockMarkers } from '../core/upgrades.js';
import { formatMoney } from '../core/format.js';

/**
 * UnlockMarkers — the world-space "buy it here" markers: one white ground
 * circle + floating cost label per available create/hire purchase (the list
 * comes from core/upgrades.getUnlockMarkers; placement/visual tunables from
 * settings.unlockMarkers). Tapping a circle while standing within
 * settings.unlockMarkers.interactRadius triggers the purchase — main.js
 * raycasts via this view's raycast() and routes the hit to
 * core/upgrades.buyUnlockMarker, exactly like the pit/pump tap flows.
 *
 * Render-only: reads core state through the marker view model, never mutates.
 * Markers change rarely (a purchase, a gate opening, a cost step), so update()
 * diffs a signature of the whole list and rebuilds everything on any change —
 * a handful of meshes, far cheaper than per-marker reconciliation would earn.
 */
export class UnlockMarkers {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.group = new THREE.Group();
    this.sm.add(this.group);
    this.circles = []; // raycast targets; each carries its marker in userData
    this.sig = '';
  }

  update(state) {
    const list = getUnlockMarkers(state);
    const sig = list.map((m) => `${m.kind}:${m.index ?? ''}:${m.cost}:${m.locked}:${m.hint}`).join('|');
    if (sig === this.sig) return;
    this.sig = sig;

    // Rebuild from scratch: dispose every old marker's geometry/materials/textures.
    for (const child of [...this.group.children]) disposeMarker(child);
    this.group.clear();
    this.circles = [];
    for (const m of list) this.#build(m);
  }

  /** The marker under the pointer, or null — { kind, index, x, z, ... }. */
  raycast(raycaster) {
    const hits = raycaster.intersectObjects(this.circles, false);
    return hits.length > 0 ? hits[0].object.userData.marker : null;
  }

  #build(m) {
    const M = settings.unlockMarkers;
    const holder = new THREE.Group();

    // The white ground circle. Locked markers fade to read as "not yet".
    const circle = new THREE.Mesh(
      new THREE.CircleGeometry(M.radius, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: m.locked ? 0.35 : 0.9,
        depthWrite: false,
      })
    );
    circle.rotation.x = -Math.PI / 2;
    // Above every painted floor decal (pit spots 0.015, lane dashes 0.014).
    circle.position.set(m.x, 0.02, m.z);
    circle.userData.marker = m;
    holder.add(circle);
    this.circles.push(circle);

    // Cost (+ hint) label: a camera-facing sprite, big enough to read from afar.
    const label = makeMarkerLabel(`$${formatMoney(m.cost)}`, m.hint, m.locked);
    label.position.set(m.x, M.labelHeight, m.z);
    holder.add(label);

    this.group.add(holder);
  }
}

/**
 * A two-line canvas sprite: the cost big on top (with a lock glyph while the
 * purchase is gated), the short hint underneath. Same canvas-texture pattern
 * as PitView's makeLabelSprite, just wide.
 */
function makeMarkerLabel(costText, hint, locked) {
  const w = 512;
  const h = 192;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 10;

  ctx.fillStyle = locked ? '#c9cdd4' : settings.colors.label;
  ctx.font = '800 84px Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(locked ? `🔒 ${costText}` : costText, w / 2, h * 0.35);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 44px Arial, sans-serif';
  ctx.fillText(hint, w / 2, h * 0.78);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(3.6, 1.35, 1);
  return sprite;
}

/** Dispose a marker holder's geometries, materials and canvas textures. */
function disposeMarker(holder) {
  holder.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
}
