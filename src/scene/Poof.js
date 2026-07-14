import * as THREE from 'three';
import settings from '../config/settings.js';
import { laneBridgeCrossings, pumpSpineLayout } from '../core/roads.js';
import { SpriteBatch } from './SpriteBatch.js';

let poofTexture = null;

function getPoofTexture() {
  if (poofTexture) return poofTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const blob = (bx, by, br) => {
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  };
  blob(size * 0.5, size * 0.52, size * 0.34);
  blob(size * 0.34, size * 0.42, size * 0.22);
  blob(size * 0.66, size * 0.4, size * 0.2);
  blob(size * 0.42, size * 0.64, size * 0.2);
  blob(size * 0.62, size * 0.62, size * 0.18);
  poofTexture = new THREE.CanvasTexture(canvas);
  return poofTexture;
}

const MAX_PUFFS = 96; // batch capacity, sized to the worst storm (market unlock ≈ 11 bursts); also caps fill-rate

export class PoofEffects {
  constructor(sceneManager) {
    this.batch = new SpriteBatch(sceneManager, {
      texture: getPoofTexture(),
      capacity: MAX_PUFFS,
      renderOrder: 10,
    });
    this.puffs = []; // live particle records, compacted in place each update
    this.free = []; // dead records, reused verbatim — spawn allocates nothing after warm-up
  }

  spawn(pos, size = 1, count = 7) {
    const y = pos.y ?? 0.6;
    for (let i = 0; i < count; i++) {
      if (this.puffs.length >= MAX_PUFFS) return; // budget spent — a burst storm reads fine without the overflow
      const p = this.free.pop() ?? {};
      const shade = 0.8 + Math.random() * 0.2; // white → light grey
      p.r = shade;
      p.g = shade;
      p.b = Math.min(1, shade + 0.03);
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.9;
      const r = (0.25 + Math.random() * 0.65) * size;
      p.x = pos.x + Math.cos(a) * r;
      p.y = y + (Math.random() - 0.2) * 0.5 * size;
      p.z = pos.z + Math.sin(a) * r;
      p.age = 0;
      p.life = 0.35 + Math.random() * 0.25;
      p.s0 = (1.15 + Math.random() * 0.9) * size;
      p.s1 = p.s0 * (1.9 + Math.random() * 0.7); // grows ~2x while fading
      p.vx = Math.cos(a) * (1.8 + Math.random() * 2.0) * size;
      p.vy = (0.9 + Math.random() * 1.4) * size;
      p.vz = Math.sin(a) * (1.8 + Math.random() * 2.0) * size;
      this.puffs.push(p);
    }
  }

  update(dt) {
    const puffs = this.puffs;
    const damp = Math.max(0, 1 - 3 * dt); // outward drift bleeds off, up-drift stays
    let w = 0; // survivors compact to the front; batch slot == survivor index
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.free.push(p);
        continue;
      }
      const t = p.age / p.life;
      const ease = 1 - (1 - t) * (1 - t); // fast pop, slow settle
      p.vx *= damp;
      p.vz *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      this.batch.set(w, p.x, p.y, p.z, p.s0 + (p.s1 - p.s0) * ease, p.r, p.g, p.b, 0.95 * (1 - t * t));
      puffs[w++] = p;
    }
    puffs.length = w;
    this.batch.commit(w);
  }
}

export class RevealPoofs {
  constructor(poofs) {
    this.poofs = poofs;
    this.prev = null; // set by the first update — baseline only, never poofs
  }

  update(state) {
    const cur = this.#snapshot(state);
    if (this.prev) this.#fire(this.prev, cur);
    this.prev = cur;
  }

  #snapshot(state) {
    const flags = (p) => ({
      room: p.roomUnlocked,
      equipped: p.equipped,
      worker: p.hasMechanic ?? p.hasAttendant,
    });
    return {
      pits: state.pits.map(flags),
      pumps: state.gasStation.pumps.map(flags),
      market: state.supermarket.unlocked,
      marketWorker: state.supermarket.workerLevel >= 1,
      cashier: state.hasCashier,
    };
  }

  #fire(prev, cur) {
    const rose = (a, b) => !a && b;
    const bridge = settings.pitLane.bridge;
    const crossings = laneBridgeCrossings();
    const spine = pumpSpineLayout();

    cur.pits.forEach((pit, i) => {
      const was = prev.pits[i];
      const p = settings.pit.positions[i];
      if (rose(was.room, pit.room)) this.poofs.spawn({ x: p.x, y: 0.6, z: p.z }, 1.6);
      if (rose(was.equipped, pit.equipped)) {
        this.poofs.spawn({ x: p.x, y: 0.6, z: p.z }, 1.3);
        const c = crossings[i];
        this.poofs.spawn({ x: c.x, y: bridge.height + 0.3, z: c.z }, 1.0);
      }
      if (rose(was.worker, pit.worker)) {
        this.poofs.spawn({ x: p.x + settings.mechanic.offsetX, y: 0.9, z: p.z + settings.mechanic.offsetZ }, 1.0);
      }
    });

    cur.pumps.forEach((pump, i) => {
      const was = prev.pumps[i];
      const p = settings.gasStation.positions[i];
      if (rose(was.room, pump.room)) {
        this.poofs.spawn({ x: p.x, y: 0.6, z: p.z }, 1.5);
        if (i === 0) this.poofs.spawn({ x: -settings.world.halfX, y: 1.0, z: settings.gasStation.gateZ }, 1.6);
      }
      if (rose(was.equipped, pump.equipped)) {
        const po = settings.gasStation.pumpOffset;
        this.poofs.spawn({ x: p.x + po.x, y: 0.9, z: p.z + po.z }, 1.2);
        const piece = spine.pieces[i];
        this.poofs.spawn({ x: (piece.xMin + piece.xMax) / 2, y: bridge.height + 0.3, z: spine.z }, 1.4);
        for (const j of piece.spurs) {
          this.poofs.spawn(
            {
              x: spine.junctions[j],
              y: bridge.height * 0.5,
              z: spine.z + bridge.width / 2 + settings.pitLane.spine.spurLength / 2,
            },
            0.9
          );
        }
      }
      if (rose(was.worker, pump.worker)) {
        this.poofs.spawn({ x: p.x + settings.attendant.offsetX, y: 0.9, z: p.z + settings.attendant.offsetZ }, 1.0);
      }
    });

    const M = settings.supermarket;
    if (rose(prev.market, cur.market)) {
      this.poofs.spawn({ x: M.workerIdleSpot.x, y: 0.8, z: M.workerIdleSpot.z }, 2.2);
      this.poofs.spawn({ x: M.checkoutPosition.x, y: 0.8, z: M.checkoutPosition.z }, 1.2);
      for (const shelf of M.shelves) this.poofs.spawn({ x: shelf.x, y: 0.8, z: shelf.z }, 1.0);
      this.poofs.spawn({ x: M.marketX, y: 1.2, z: M.customerDoorZ }, 1.0);
      this.poofs.spawn({ x: M.marketExitX, y: 1.2, z: M.customerDoorZ }, 1.0);
      this.poofs.spawn({ x: M.deliveryDoorX, y: 1.2, z: M.deliveryDoorZ }, 1.0);
    }
    if (rose(prev.marketWorker, cur.marketWorker)) {
      this.poofs.spawn({ x: M.workerIdleSpot.x, y: 0.9, z: M.workerIdleSpot.z }, 1.0);
    }
    if (rose(prev.cashier, cur.cashier)) {
      this.poofs.spawn({ x: M.cashRegisterPosition.x, y: 0.9, z: M.cashRegisterPosition.z }, 1.0);
    }
  }
}
