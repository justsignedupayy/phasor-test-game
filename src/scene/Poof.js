import * as THREE from 'three';
import settings from '../config/settings.js';
import { laneBridgeCrossings, pumpSpineLayout } from '../core/roads.js';

/**
 * Poof.js — the cartoon "poof" reveal effect: a short burst of soft, puffy
 * cloud sprites that pops at a spot, expands and fades out over ~0.3-0.55s,
 * then removes itself. Fully procedural (a lumpy radial-gradient canvas
 * texture drawn once, tinted white-to-light-grey per puff) — no model.
 *
 * PoofEffects is the reusable effect: spawn(pos, size) anywhere, update(dt)
 * once per frame from the main loop.
 *
 * RevealPoofs is the trigger layer: it watches core state per frame for the
 * rising edges the render layer already gates visibility on (roomUnlocked,
 * equipped, hires, market/cashier unlocks) and fires
 * a poof at each newly revealed object's world spot. Its first update only
 * BASELINES the flags, so resuming a save never poofs the existing world.
 * Pure observation — unlock logic, timing and costs live in core, untouched.
 */

let poofTexture = null;

/** The shared puff sprite texture: a handful of overlapping soft radial blobs
 * on a canvas, so each sprite reads as a lumpy little cloud, not a flat disc. */
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

export class PoofEffects {
  constructor(sceneManager) {
    this.group = new THREE.Group();
    sceneManager.add(this.group);
    this.puffs = [];
  }

  /**
   * Burst a poof cloud at pos {x, y?, z} (y defaults to prop mid-height);
   * `size` scales the whole burst (1 ≈ a small prop-sized reveal).
   */
  spawn(pos, size = 1) {
    const tex = getPoofTexture();
    const count = 10;
    const y = pos.y ?? 0.6;
    for (let i = 0; i < count; i++) {
      const shade = 0.8 + Math.random() * 0.2; // white → light grey
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: new THREE.Color(shade, shade, Math.min(1, shade + 0.03)),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.9;
      const r = (0.25 + Math.random() * 0.65) * size;
      sprite.position.set(pos.x + Math.cos(a) * r, y + (Math.random() - 0.2) * 0.5 * size, pos.z + Math.sin(a) * r);
      const s0 = (1.0 + Math.random() * 0.8) * size;
      sprite.scale.setScalar(s0);
      this.group.add(sprite);
      this.puffs.push({
        sprite,
        age: 0,
        life: 0.35 + Math.random() * 0.25,
        s0,
        s1: s0 * (1.9 + Math.random() * 0.7), // grows ~2x while fading
        vx: Math.cos(a) * (1.8 + Math.random() * 2.0) * size,
        vy: (0.9 + Math.random() * 1.4) * size,
        vz: Math.sin(a) * (1.8 + Math.random() * 2.0) * size,
      });
    }
  }

  update(dt) {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this.group.remove(p.sprite);
        p.sprite.material.dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      const ease = 1 - (1 - t) * (1 - t); // fast pop, slow settle
      p.sprite.scale.setScalar(p.s0 + (p.s1 - p.s0) * ease);
      p.sprite.material.opacity = 0.95 * (1 - t * t);
      const damp = Math.max(0, 1 - 3 * dt); // outward drift bleeds off, up-drift stays
      p.vx *= damp;
      p.vz *= damp;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
    }
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

  /** The per-frame boolean picture of everything reveal-gated in the world. */
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

  /** One poof per rising edge, at the spot the views reveal the new object. */
  #fire(prev, cur) {
    const rose = (a, b) => !a && b;
    const bridge = settings.pitLane.bridge;
    const crossings = laneBridgeCrossings();
    const spine = pumpSpineLayout();

    cur.pits.forEach((pit, i) => {
      const was = prev.pits[i];
      const p = settings.pit.positions[i];
      // Expand Room: the lot's floor reveals and the land fence slides right.
      if (rose(was.room, pit.room)) this.poofs.spawn({ x: p.x, y: 0.6, z: p.z }, 1.6);
      // Equipment: the pit spot, shelf, tire stack AND its lane bridge appear.
      if (rose(was.equipped, pit.equipped)) {
        this.poofs.spawn({ x: p.x, y: 0.6, z: p.z }, 1.3);
        const c = crossings[i];
        this.poofs.spawn({ x: c.x, y: bridge.height + 0.3, z: c.z }, 1.0);
      }
      // Hire: the mechanic pops in at its work spot.
      if (rose(was.worker, pit.worker)) {
        this.poofs.spawn({ x: p.x + settings.mechanic.offsetX, y: 0.9, z: p.z + settings.mechanic.offsetZ }, 1.0);
      }
    });

    cur.pumps.forEach((pump, i) => {
      const was = prev.pumps[i];
      const p = settings.gasStation.positions[i];
      // Lot unlock: the lot ground appears — and for lot 0 the whole station
      // (gate, road) pops into existence, so the gate gets its own poof.
      if (rose(was.room, pump.room)) {
        this.poofs.spawn({ x: p.x, y: 0.6, z: p.z }, 1.5);
        if (i === 0) this.poofs.spawn({ x: -settings.world.halfX, y: 1.0, z: settings.gasStation.gateZ }, 1.6);
      }
      // Equip: the pump prop appears, and the walkway spine grows a piece
      // (deck stretch + its new spur(s)) to reach across this pump's lane.
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
    // Market unlock reveals the whole shop at once: one big poof mid-floor,
    // one at the checkout, one per shelf/freezer, and one on each sliding
    // door that comes into existence with the market — the customer entry +
    // exit (back-wall corridors) and the restock truck's delivery gate (all
    // three share the unlocked flag; see scene/SlidingDoors.js).
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
