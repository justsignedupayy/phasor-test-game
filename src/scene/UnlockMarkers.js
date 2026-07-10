import * as THREE from 'three';
import settings from '../config/settings.js';
import { getUnlockMarkers, buyUnlockMarker } from '../core/upgrades.js';
import { formatMoney } from '../core/format.js';
import { spawnFlyingBills } from './MoneyFly.js';
import { playMoneySound } from '../platform/audio.js';
import { getMoneyIcon, getLockIcon } from './icons.js';

/**
 * UnlockMarkers — the world-space "buy it here" markers: one white ground
 * circle + floating cost label per available create/hire purchase (the list
 * comes from core/upgrades.getUnlockMarkers; placement/visual tunables from
 * settings.unlockMarkers). Standing within settings.unlockMarkers.interactRadius
 * of a marker drains its cost continuously at cost/unlockDuration per second —
 * so EVERY unlock completes after exactly unlockDuration seconds of standing in
 * it, whatever it costs. Flying bills (scene/MoneyFly.js, PitMoney's collection
 * flight in reverse) are spawned on a fixed billInterval cadence purely as the
 * visual for that flow — the drain itself is per-frame and continuous.
 *
 * The drain is real cash (the HUD ticks down live, not a cosmetic delay) and
 * only begins after startDelay seconds in the circle — required afresh on
 * EVERY entry, so a walk-through costs nothing. Once money has flowed, leaving
 * keeps it paid: the label shows the remaining balance and a later visit
 * resumes the drain from it (after the delay again). Leaving during the delay
 * before any cash was ever taken cancels outright. A cash-starved drain simply
 * stalls (it only takes what the player has) and resumes, stretching past
 * unlockDuration until the full cost has flowed. Only then does the purchase
 * complete: buyUnlockMarker fires (same gates as ever), refunding the drained
 * total first so its own atomic cash check + deduction nets to exactly one
 * full-cost charge overall.
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
    this.progress = new Map(); // "kind:index" -> { paid, sendTimer, flights[] } — one live drain per marker
    this.labels = new Map(); // "kind:index" -> cost label sprite, so a payment can redraw it in place
    this.wedges = new Map(); // "kind:index" -> pie-wedge fill mesh, so a payment can regrow it in place
    this.orphanFlights = []; // bill visuals still airborne after their drain ended (refund/complete)
  }

  update(dt, state, playerPos) {
    const list = getUnlockMarkers(state);
    const sig = list
      .map((m) => `${m.kind}:${m.index ?? ''}:${m.cost}:${m.locked}:${m.hint}:${m.category}`)
      .join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      // Rebuild from scratch: dispose every old marker's geometry/materials/textures.
      for (const child of [...this.group.children]) disposeMarker(child);
      this.group.clear();
      this.labels.clear();
      this.wedges.clear();
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

      if (inRange) {
        if (!p) {
          p = { paid: 0, sendTimer: 0, flights: [], started: false, delayTimer: 0 };
          this.progress.set(key, p);
        }
        // Every entry (first visit or resume) waits startDelay before any cash
        // moves — a walk-through never nicks the wallet.
        if (!p.started) {
          p.delayTimer += dt;
          if (p.delayTimer >= M.startDelay) p.started = true;
        }
        if (p.started) {
          // Fixed-duration drain: rate = cost / unlockDuration, so any unlock
          // completes after exactly unlockDuration seconds in the circle. Capped
          // by cash on hand — a broke drain stalls and resumes, never overdraws.
          const amount = Math.min((m.cost / M.unlockDuration) * dt, m.cost - p.paid, state.cash);
          if (amount > 0) {
            state.cash -= amount;
            p.paid += amount;
            this.#refreshLabel(key, Math.max(0, m.cost - p.paid), m);
            this.#growWedge(key, Math.PI * 2 * (p.paid / m.cost));
            // Cosmetic bill flights pace the continuous drain, one per interval.
            p.sendTimer -= dt;
            if (p.sendTimer <= 0) {
              p.sendTimer = M.billInterval;
              p.flights.push(
                spawnFlyingBills(
                  this.sm,
                  1,
                  { x: playerPos.x, y: 1.0, z: playerPos.z },
                  { x: m.x, z: m.z },
                  { duration: M.billFlyDuration }
                )
              );
            }
          }
          if (p.paid >= m.cost - 1e-9) this.#finalize(state, m, key);
        }
      } else if (p) {
        if (p.paid > 0) {
          // Left mid-drain (or the marker re-locked): the cash already drained
          // stays paid — the label keeps showing the remaining balance, and
          // re-entering waits the full startDelay again before resuming.
          p.started = false;
          p.delayTimer = 0;
        } else {
          // Left before any cash was ever taken: cancel outright.
          this.progress.delete(key);
          this.#refreshLabel(key, m.cost, m);
        }
      }

      p = this.progress.get(key); // finalize/refund above may have removed it
      if (p) {
        for (let i = p.flights.length - 1; i >= 0; i--) {
          p.flights[i].update(dt);
          if (p.flights[i].done) p.flights.splice(i, 1);
        }
      }
    }

    for (let i = this.orphanFlights.length - 1; i >= 0; i--) {
      this.orphanFlights[i].update(dt);
      if (this.orphanFlights[i].done) this.orphanFlights.splice(i, 1);
    }
  }

  /**
   * The full cost has drained: refund the total already deducted frame-by-frame,
   * then let buyUnlockMarker do its normal atomic afford-check + deduction +
   * effect. Refund and re-deduct are the same amount in the same tick, so cash
   * never visibly jumps — this just lets the untouched core function do the
   * one thing only it knows how to (apply kind/index's actual effect) without
   * double-charging for a cost this view already collected as a flow.
   */
  #finalize(state, m, key) {
    const p = this.progress.get(key);
    if (!p) return;
    state.cash += p.paid;
    buyUnlockMarker(state, m.kind, m.index);
    playMoneySound();
    this.orphanFlights.push(...p.flights); // airborne bills finish their flight
    this.progress.delete(key);
  }

  /** Redraw a marker's cost label in place (no geometry rebuild) as its balance drops. */
  #refreshLabel(key, remainingCost, m) {
    const label = this.labels.get(key);
    if (!label) return;
    const costText = formatMoney(remainingCost); // the money icon draws in place of a literal '$'
    if (label.userData.lastCostText === costText) return; // continuous drain: skip no-op redraws
    label.userData.lastCostText = costText;
    updateMarkerLabel(label, costText, m);
  }

  /** Regrow a marker's cash-fill wedge to thetaLength radians (dispose+replace geometry). */
  #growWedge(key, thetaLength) {
    const wedge = this.wedges.get(key);
    if (!wedge) return;
    wedge.geometry.dispose();
    wedge.geometry = new THREE.CircleGeometry(settings.unlockMarkers.radius, 40, Math.PI / 2, thetaLength);
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

    // Cash-fill wedge: grows clockwise from 12 o'clock as the drain pays down
    // this marker's cost, in wedgeColor (a solid dark green — money.cashTintColor
    // is too pale once spread across a large flat fill). Same y as the base
    // circle, NOT a y gap: the camera is an angled isometric ortho (see
    // settings.camera), so lifting the wedge even 0.01 above the circle shifts
    // its on-screen projection sideways relative to the circle beneath it — a
    // thin partial wedge's footprint lands mostly off the circle and barely
    // reads, only converging back onto the circle's footprint near 100% fill
    // (exactly the "invisible until nearly done" symptom). depthWrite:false on
    // both meshes means they never depth-fight each other regardless of y, so
    // real occlusion by nearer 3D geometry (characters, cars) still comes for
    // free from the normal depth test against the opaque buffer drawn earlier
    // — coplanar + depthTest:true is safe. What still needs forcing is PAINT
    // ORDER between these two specific coplanar meshes (camera-distance sort
    // ties at identical positions and can flip frame to frame): renderOrder
    // makes that deterministic without touching depth at all. Color/opacity
    // are fixed constants; the fill amount is communicated purely by sweep angle.
    const key = `${m.kind}:${m.index ?? ''}`;
    const paidSoFar = this.progress.get(key)?.paid ?? 0;
    const initialTheta = Math.PI * 2 * (paidSoFar / m.cost);
    const wedge = new THREE.Mesh(
      new THREE.CircleGeometry(M.radius, 40, Math.PI / 2, initialTheta),
      new THREE.MeshBasicMaterial({
        color: settings.unlockMarkers.wedgeColor,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      })
    );
    wedge.rotation.x = -Math.PI / 2;
    wedge.position.set(m.x, 0.02, m.z); // same y as the base circle — see note above
    wedge.renderOrder = 1; // paints after circle's default 0, deterministically
    holder.add(wedge);
    this.wedges.set(key, wedge);

    // Cost (+ category + hint) label: a camera-facing sprite, big enough to read
    // from afar. Shows the REMAINING balance, not the original cost, in case this
    // marker already has a partial payment in flight from before the rebuild.
    const label = makeMarkerLabel(formatMoney(Math.max(0, m.cost - paidSoFar)), m);
    // The gas-gate marker's label rides higher so it clears the cashier
    // marker's label next door (see settings.unlockMarkers.gasEntryLabelHeight).
    const labelY = m.kind === 'gasExpand' && m.index === 0 ? M.gasEntryLabelHeight : M.labelHeight;
    label.position.set(m.x, labelY, m.z);
    holder.add(label);
    this.labels.set(key, label);

    this.group.add(holder);
  }
}

/**
 * A three-line canvas sprite: the cost big on top (a money icon, plus a lock
 * icon while the purchase is gated, before the number), the marker's category
 * name beneath it, and the short hint at the bottom. Same canvas-texture
 * pattern as PitView's makeLabelSprite, just wide.
 */
function makeMarkerLabel(numberText, m) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 240;
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  // depthTest off + late renderOrder: these labels are UI, not scenery — on the
  // isometric camera a wall/fence/prop between marker and camera would otherwise
  // slice the sprite along its silhouette (e.g. the rep-locked lot's label half
  // vanishing behind the front wall).
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
  );
  sprite.renderOrder = 20;
  // Same width as ever; height keeps the canvas' aspect (240/512) so the added
  // category line doesn't squash the drawing.
  sprite.scale.set(3.6, 1.69, 1);
  drawMarkerLabel(canvas, numberText, m);
  tex.needsUpdate = true;
  return sprite;
}

/** Redraws a marker label sprite's existing canvas/texture in place — no new texture allocated. */
function updateMarkerLabel(sprite, numberText, m) {
  const tex = sprite.material.map;
  drawMarkerLabel(tex.image, numberText, m);
  tex.needsUpdate = true;
}

function drawMarkerLabel(canvas, numberText, m) {
  const { hint, locked, category } = m;
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 10;

  // Cost line: the money icon (and, while locked, the lock icon before it)
  // drawn immediately before the number, the icon(s) + number centered
  // together as one group — the same combined-and-centered layout the old
  // `🔒 $1,234` text had, with drawn icons standing in for its literal glyphs.
  const fontSize = 84;
  ctx.font = `800 ${fontSize}px ${settings.ui.fontStack}`;
  ctx.textBaseline = 'middle';
  const costY = h * 0.26;
  const numberWidth = ctx.measureText(numberText).width;
  const capHeight = fontSize * 0.72; // ~cap-height of this bold sans at fontSize
  const iconGap = 12;

  // The lock reads too small drawn at plain cap-height, so it gets its own
  // larger scale — each icon still centers vertically on costY regardless of
  // its own height, only the money icon matches the digits' cap-height exactly.
  const icons = [];
  if (locked) icons.push({ img: getLockIcon(), height: capHeight * 2 });
  icons.push({ img: getMoneyIcon(), height: capHeight });
  const iconWidths = icons.map(({ img, height }) => height * (img.naturalWidth / img.naturalHeight));
  const iconsWidth = iconWidths.reduce((sum, iw) => sum + iw + iconGap, 0);

  let x = w / 2 - (iconsWidth + numberWidth) / 2;
  ctx.textAlign = 'left';
  icons.forEach(({ img, height }, i) => {
    const iw = iconWidths[i];
    ctx.drawImage(img, x, costY - height / 2, iw, height);
    x += iw + iconGap;
  });
  ctx.fillStyle = locked ? '#c9cdd4' : settings.colors.label;
  ctx.fillText(numberText, x, costY);

  // A line's font shrinks by its overflow ratio so it always fits one line,
  // floored at a still-readable size (a too-long line at the floor just clips
  // a little rather than vanishing into an unreadable smear).
  const maxWidth = w - 40;
  const fitLine = (text, weight, size, floor, color, y) => {
    ctx.font = `${weight} ${size}px ${settings.ui.fontStack}`;
    const width = ctx.measureText(text).width;
    if (width > maxWidth) {
      ctx.font = `${weight} ${Math.max(floor, Math.floor(size * (maxWidth / width)))}px ${settings.ui.fontStack}`;
    }
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, y);
  };

  ctx.textAlign = 'center';
  // Category/name line ("Hire Worker", "Gas Station Upgrade", …): what this
  // marker IS, self-explanatory at a glance even outside the tutorial.
  fitLine(category ?? '', '800', 46, 30, '#ffffff', h * 0.55);
  // The situational hint line ("Hire worker A", "Finish the garage & market first").
  fitLine(hint, '700', 36, 26, '#d8dee6', h * 0.85);
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
