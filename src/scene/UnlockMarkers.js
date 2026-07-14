import * as THREE from 'three';
import settings from '../config/settings.js';
import { getUnlockMarkers, buyUnlockMarker } from '../core/upgrades.js';
import { formatMoney } from '../core/format.js';
import { spawnFlyingBills } from './MoneyFly.js';
import { playMoneySound } from '../platform/audio.js';
import { getMoneyIcon, getLockIcon } from './icons.js';

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
      const inRange = dist <= M.interactRadius && !m.locked;
      let p = this.progress.get(key);

      if (inRange) {
        if (!p) {
          p = { paid: 0, sendTimer: 0, flights: [], started: false, delayTimer: 0 };
          this.progress.set(key, p);
        }
        if (!p.started) {
          p.delayTimer += dt;
          if (p.delayTimer >= M.startDelay) p.started = true;
        }
        if (p.started) {
          const amount = Math.min((m.cost / M.unlockDuration) * dt, m.cost - p.paid, state.cash);
          if (amount > 0) {
            state.cash -= amount;
            p.paid += amount;
            this.#refreshLabel(key, Math.max(0, m.cost - p.paid), m);
            this.#growWedge(key, Math.PI * 2 * (p.paid / m.cost));
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
          p.started = false;
          p.delayTimer = 0;
        } else {
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

  getPaidAmount(kind, index) {
    return this.progress.get(`${kind}:${index ?? ''}`)?.paid ?? 0;
  }

  #finalize(state, m, key) {
    const p = this.progress.get(key);
    if (!p) return;
    state.cash += p.paid;
    buyUnlockMarker(state, m.kind, m.index);
    playMoneySound();
    this.orphanFlights.push(...p.flights); // airborne bills finish their flight
    this.progress.delete(key);
  }

  #refreshLabel(key, remainingCost, m) {
    const label = this.labels.get(key);
    if (!label) return;
    const costText = formatMoney(remainingCost); // the money icon draws in place of a literal '$'
    if (label.userData.lastCostText === costText) return; // continuous drain: skip no-op redraws
    label.userData.lastCostText = costText;
    updateMarkerLabel(label, costText, m);
  }

  #growWedge(key, thetaLength) {
    const wedge = this.wedges.get(key);
    if (!wedge) return;
    wedge.geometry.dispose();
    wedge.geometry = new THREE.CircleGeometry(settings.unlockMarkers.radius, 40, Math.PI / 2, thetaLength);
  }

  #build(m) {
    const M = settings.unlockMarkers;
    const holder = new THREE.Group();

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
    circle.position.set(m.x, 0.02, m.z);
    holder.add(circle);

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

    const label = makeMarkerLabel(formatMoney(Math.max(0, m.cost - paidSoFar)), m);
    const labelY = m.kind === 'gasExpand' && m.index === 0 ? M.gasEntryLabelHeight : M.labelHeight;
    label.position.set(m.x, labelY, m.z);
    holder.add(label);
    this.labels.set(key, label);

    this.group.add(holder);
  }
}

function makeMarkerLabel(numberText, m) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 240;
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
  );
  sprite.renderOrder = 20;
  sprite.scale.set(3.6, 1.69, 1);
  drawMarkerLabel(canvas, numberText, m);
  tex.needsUpdate = true;
  return sprite;
}

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

  const fontSize = 84;
  ctx.font = `800 ${fontSize}px ${settings.ui.fontStack}`;
  ctx.textBaseline = 'middle';
  const costY = h * 0.26;
  const numberWidth = ctx.measureText(numberText).width;
  const capHeight = fontSize * 0.72; // ~cap-height of this bold sans at fontSize
  const iconGap = 12;

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
  fitLine(category ?? '', '800', 46, 30, '#ffffff', h * 0.55);
  fitLine(hint, '700', 36, 26, '#d8dee6', h * 0.85);
}

function disposeMarker(holder) {
  holder.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
}
