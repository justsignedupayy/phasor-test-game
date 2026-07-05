import * as THREE from 'three';
import settings from '../config/settings.js';
import { getUnlockMarkers, buyUnlockMarker } from '../core/upgrades.js';
import { formatMoney } from '../core/format.js';
import { spawnFlyingBills } from './MoneyFly.js';

/**
 * UnlockMarkers — the world-space "buy it here" markers: one white ground
 * circle + floating cost label per available create/hire purchase (the list
 * comes from core/upgrades.getUnlockMarkers; placement/visual tunables from
 * settings.unlockMarkers). Standing within settings.unlockMarkers.interactRadius
 * of a marker pays it down gradually — see update() below — one real $billValue
 * bill at a time, animated flying from the player to the marker's spot
 * (scene/MoneyFly.js), mirroring PitMoney's collection flight in reverse.
 *
 * The transaction is genuinely incremental and resumable: each bill's value is
 * deducted from state.cash the instant it's sent (so the HUD ticks down in real
 * time, not a cosmetic delay), and per-marker progress (this.progress) persists
 * across interruptions — walk away mid-purchase and whatever's already been
 * sent stays spent; walk back and it resumes from there. Only once the final
 * bill lands does the purchase actually complete: buyUnlockMarker fires (same
 * gates as ever), refunding the incrementally-spent total first so its own
 * atomic cash check + deduction nets to exactly one full-cost charge overall.
 *
 * Render-only otherwise: reads core state through the marker view model, only
 * ever mutates cash/state via the same core/upgrades.buyUnlockMarker every
 * purchase always went through. Markers change rarely (a purchase, a gate
 * opening, a cost step), so the ground-circle/label visuals diff a signature
 * of the whole list and rebuild everything on any change — a handful of
 * meshes, far cheaper than per-marker reconciliation would earn.
 */
export class UnlockMarkers {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.group = new THREE.Group();
    this.sm.add(this.group);
    this.sig = '';
    this.progress = new Map(); // "kind:index" -> { paid, sendTimer, flights[] } — survives across visits
    this.labels = new Map(); // "kind:index" -> cost label sprite, so a payment can redraw it in place
  }

  update(dt, state, playerPos) {
    const list = getUnlockMarkers(state);
    const sig = list.map((m) => `${m.kind}:${m.index ?? ''}:${m.cost}:${m.locked}:${m.hint}`).join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      // Rebuild from scratch: dispose every old marker's geometry/materials/textures.
      for (const child of [...this.group.children]) disposeMarker(child);
      this.group.clear();
      this.labels.clear();
      for (const m of list) this.#build(m);
    }

    const M = settings.unlockMarkers;
    for (const m of list) {
      const key = `${m.kind}:${m.index ?? ''}`;
      const dist = Math.hypot(playerPos.x - m.x, playerPos.z - m.z);
      // Locked markers (reputation/prereq gates) never accept a deposit — only
      // cash affordability is meant to be paid down incrementally.
      const inRange = dist <= M.interactRadius && !m.locked;
      let p = this.progress.get(key);

      if (inRange && (!p || p.paid < m.cost)) {
        if (!p) {
          p = { paid: 0, sendTimer: 0, flights: [] };
          this.progress.set(key, p);
        }
        p.sendTimer -= dt;
        if (p.sendTimer <= 0) {
          p.sendTimer = M.billInterval;
          const remaining = m.cost - p.paid;
          const amount = Math.min(M.billValue, remaining, state.cash);
          if (amount > 0) {
            state.cash -= amount;
            p.paid += amount;
            const isLast = p.paid >= m.cost;
            this.#refreshLabel(key, Math.max(0, m.cost - p.paid), m);
            p.flights.push(
              spawnFlyingBills(
                this.sm,
                1,
                { x: playerPos.x, y: 1.0, z: playerPos.z },
                { x: m.x, z: m.z },
                { duration: M.billFlyDuration, onBillArrive: () => isLast && this.#finalize(state, m, key) }
              )
            );
          }
          // else: not enough cash yet — just retry after the usual interval.
        }
      }

      if (p) {
        for (let i = p.flights.length - 1; i >= 0; i--) {
          p.flights[i].update(dt);
          if (p.flights[i].done) p.flights.splice(i, 1);
        }
      }
    }
  }

  /**
   * The final bill has landed: refund the total already deducted bill-by-bill,
   * then let buyUnlockMarker do its normal atomic afford-check + deduction +
   * effect. Refund and re-deduct are the same amount in the same tick, so cash
   * never visibly jumps — this just lets the untouched core function do the
   * one thing only it knows how to (apply kind/index's actual effect) without
   * double-charging for a cost this view already collected in installments.
   */
  #finalize(state, m, key) {
    const p = this.progress.get(key);
    if (!p) return;
    state.cash += p.paid;
    buyUnlockMarker(state, m.kind, m.index);
    this.progress.delete(key);
  }

  /** Redraw a marker's cost label in place (no geometry rebuild) as its balance drops. */
  #refreshLabel(key, remainingCost, m) {
    const label = this.labels.get(key);
    if (!label) return;
    updateMarkerLabel(label, `$${formatMoney(remainingCost)}`, m.hint, m.locked);
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
    holder.add(circle);

    // Cost (+ hint) label: a camera-facing sprite, big enough to read from afar.
    // Shows the REMAINING balance, not the original cost, in case this marker
    // already has a partial payment in flight from before the rebuild.
    const key = `${m.kind}:${m.index ?? ''}`;
    const paidSoFar = this.progress.get(key)?.paid ?? 0;
    const label = makeMarkerLabel(`$${formatMoney(Math.max(0, m.cost - paidSoFar))}`, m.hint, m.locked);
    label.position.set(m.x, M.labelHeight, m.z);
    holder.add(label);
    this.labels.set(key, label);

    this.group.add(holder);
  }
}

/**
 * A two-line canvas sprite: the cost big on top (with a lock glyph while the
 * purchase is gated), the short hint underneath. Same canvas-texture pattern
 * as PitView's makeLabelSprite, just wide.
 */
function makeMarkerLabel(costText, hint, locked) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(3.6, 1.35, 1);
  drawMarkerLabel(canvas, costText, hint, locked);
  tex.needsUpdate = true;
  return sprite;
}

/** Redraws a marker label sprite's existing canvas/texture in place — no new texture allocated. */
function updateMarkerLabel(sprite, costText, hint, locked) {
  const tex = sprite.material.map;
  drawMarkerLabel(tex.image, costText, hint, locked);
  tex.needsUpdate = true;
}

function drawMarkerLabel(canvas, costText, hint, locked) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
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
