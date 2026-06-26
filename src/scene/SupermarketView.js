import * as THREE from 'three';
import settings from '../config/settings.js';
import { cloneStorageModel } from './StorageModels.js';
import { MarketWorker } from './MarketWorker.js';
import { MarketCustomer } from './MarketCustomer.js';

/**
 * SupermarketView — the whole shop's render layer: 4 shelves (shelf_end.glb /
 * freezers_standing.glb) with a live stock label, a checkout counter + Bag.glb
 * (shown only once a finished order is placed there), the outside restock
 * pile, every customer NPC, and the market worker once hired. No game logic;
 * everything here mirrors state.supermarket. Tap targets (shelf/checkout/
 * restock pile) are exposed via raycastTap() for main.js to dispatch into
 * core/supermarket.js, same split as CarYard.raycast() + PitView's rings.
 */
const RING_PULSE_HZ = 5; // matches PitView/Computer's highlight pulse

export class SupermarketView {
  constructor(sceneManager, gltf) {
    this.sm = sceneManager;
    this.gltf = gltf;

    this.worker = null; // MarketWorker, spawned once workerLevel >= 1
    this.customers = new Map(); // customerId -> MarketCustomer
    this.highlightT = 0;

    this.#buildShelves();
    this.#buildCheckout();
    this.#buildRestockPile();
    this.#buildCarriedBox();
  }

  #buildShelves() {
    const M = settings.supermarket;
    this.shelves = M.shelves.map((cfg, i) => {
      const ox = cfg.offset?.x ?? 0;
      const oz = cfg.offset?.z ?? 0;

      const model = cloneStorageModel(cfg.model);
      model.scale.setScalar(cfg.model === 'shelfEnd' ? M.shelfScale : M.freezerScale);
      model.position.set(cfg.x + ox, 0, cfg.z + oz);
      model.visible = false;
      this.sm.add(model);

      const label = makeLabelSprite();
      label.position.set(cfg.x + ox, 2.6, cfg.z + oz);
      label.visible = false;
      this.sm.add(label);

      const ring = makeRing(cfg.x + ox, cfg.z + oz);
      this.sm.add(ring);

      return { index: i, cfg, model, label, ring, labelText: '' };
    });
  }

  #buildCheckout() {
    const M = settings.supermarket;
    const c = settings.colors;
    const pos = M.checkoutPosition;

    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.85, 0.8),
      new THREE.MeshStandardMaterial({ color: c.deskWood, flatShading: true })
    );
    counter.position.set(pos.x, 0.425, pos.z);
    counter.castShadow = true;
    counter.receiveShadow = true;
    counter.visible = false;
    this.sm.add(counter);
    this.checkoutCounter = counter;

    this.bag = cloneStorageModel('bag');
    this.bag.scale.setScalar(M.bagScale);
    this.bag.position.set(pos.x, 0.85, pos.z);
    this.bag.visible = false;
    this.sm.add(this.bag);

    this.checkoutRing = makeRing(pos.x, pos.z);
    this.sm.add(this.checkoutRing);
  }

  /** A small decorative pile (infinite, never depletes) at the exterior restock spot. */
  #buildRestockPile() {
    const M = settings.supermarket;
    const pos = M.restockBoxPosition;
    const offsets = [
      { x: -0.3, z: 0 },
      { x: 0.3, z: 0 },
      { x: 0, z: 0.4 },
    ];
    this.pileBoxes = offsets.map((o) => {
      const box = cloneStorageModel('box');
      box.scale.setScalar(M.restockPileScale);
      box.position.set(pos.x + o.x, 0, pos.z + o.z);
      box.visible = false;
      this.sm.add(box);
      return box;
    });

    this.restockRing = makeRing(pos.x, pos.z);
    this.sm.add(this.restockRing);
  }

  /** The box the PLAYER (manual restocking) carries from the pile to a shelf. */
  #buildCarriedBox() {
    this.carriedBox = cloneStorageModel('box');
    this.carriedBox.scale.setScalar(settings.storage.boxScale);
    this.carriedBox.visible = false;
    this.sm.add(this.carriedBox);
  }

  /** Tap raycast against shelves/checkout/restock pile; null if nothing hit. */
  raycastTap(raycaster) {
    for (const shelf of this.shelves) {
      if (shelf.model.visible && raycaster.intersectObject(shelf.model, true).length > 0) {
        return { kind: 'shelf', index: shelf.index };
      }
    }
    if (this.checkoutCounter.visible && raycaster.intersectObject(this.checkoutCounter, true).length > 0) {
      return { kind: 'checkout' };
    }
    if (this.pileBoxes[0].visible && raycaster.intersectObjects(this.pileBoxes, true).length > 0) {
      return { kind: 'restockBox' };
    }
    return null;
  }

  update(dt, state) {
    const S = state.supermarket;
    const unlocked = S.unlocked;

    for (const shelf of this.shelves) {
      shelf.model.visible = unlocked;
      shelf.label.visible = unlocked;
      if (!unlocked) continue;
      const stateShelf = S.shelves[shelf.index];
      const text = `${stateShelf.productType} ${stateShelf.stock}/${settings.supermarket.shelfCapacity}`;
      if (text !== shelf.labelText) {
        shelf.labelText = text;
        drawLabelSprite(shelf.label, text);
      }
    }

    this.checkoutCounter.visible = unlocked;
    this.bag.visible = unlocked && !!S.checkoutBag;
    for (const box of this.pileBoxes) box.visible = unlocked;

    this.#updateCarriedBox(state.player);
    this.#syncCustomers(dt, S);

    if (S.workerLevel >= 1 && !this.worker) {
      this.worker = new MarketWorker(this.gltf);
      this.sm.add(this.worker.root);
    }
    if (this.worker) this.worker.update(dt, S.worker);

    this.#updateHighlights(dt, state);
  }

  /** Floats the carried-restock-box model just ahead of the player, mirroring CarriedBox.js. */
  #updateCarriedBox(player) {
    if (!player.carryingRestockBox) {
      this.carriedBox.visible = false;
      return;
    }
    this.carriedBox.visible = true;
    const o = settings.storage.carriedBoxOffset;
    const fwdX = Math.sin(player.rotation);
    const fwdZ = Math.cos(player.rotation);
    this.carriedBox.position.set(player.position.x + fwdX * o.forward, o.y, player.position.z + fwdZ * o.forward);
    this.carriedBox.rotation.y = player.rotation;
  }

  #syncCustomers(dt, S) {
    const liveIds = new Set();
    for (const customer of S.customerQueue) {
      liveIds.add(customer.id);
      let view = this.customers.get(customer.id);
      if (!view) {
        view = new MarketCustomer(this.gltf, customer);
        this.sm.add(view.root);
        this.customers.set(customer.id, view);
      }
      view.update(dt, customer);
    }
    for (const [id, view] of this.customers) {
      if (!liveIds.has(id)) {
        view.dispose(this.sm);
        this.customers.delete(id);
      }
    }
  }

  /** Tap-affordance rings: pulse only where a manual action is actually available right now. */
  #updateHighlights(dt, state) {
    const S = state.supermarket;
    const M = settings.supermarket;
    const player = state.player;
    this.highlightT += dt;
    const pulse = 0.45 + 0.22 * Math.sin(this.highlightT * RING_PULSE_HZ);
    const k = Math.min(1, 8 * dt);
    const near = (pos) => Math.hypot(player.position.x - pos.x, player.position.z - pos.z) <= M.interactRadius;

    for (const shelf of this.shelves) {
      const canCollect = S.unlocked && S.workerLevel === 0 && !player.carryingRestockBox && near(shelf.cfg);
      const canRestock = S.unlocked && S.workerLevel < 2 && player.carryingRestockBox && near(shelf.cfg);
      const target = canCollect || canRestock ? pulse : 0;
      shelf.ring.visible = S.unlocked;
      shelf.ring.material.opacity += (target - shelf.ring.material.opacity) * k;
    }

    const canPlace = S.unlocked && S.workerLevel === 0 && near(M.checkoutPosition);
    this.checkoutRing.visible = S.unlocked;
    this.checkoutRing.material.opacity += ((canPlace ? pulse : 0) - this.checkoutRing.material.opacity) * k;

    const canGrabBox = S.unlocked && S.workerLevel < 2 && !player.carryingRestockBox && near(S.restockBoxPosition);
    this.restockRing.visible = S.unlocked;
    this.restockRing.material.opacity += ((canGrabBox ? pulse : 0) - this.restockRing.material.opacity) * k;
  }
}

// A camera-facing text label rendered to a small canvas texture (mirrors PitView's storage label).
function makeLabelSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(2.2, 0.55, 1);
  sprite.userData.canvas = canvas;
  sprite.userData.tex = tex;
  return sprite;
}

function drawLabelSprite(sprite, text) {
  const canvas = sprite.userData.canvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = settings.colors.label;
  ctx.font = '800 30px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  sprite.userData.tex.needsUpdate = true;
}

function makeRing(x, z) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(settings.supermarket.interactRadius * 0.78, settings.supermarket.interactRadius, 40),
    new THREE.MeshBasicMaterial({
      color: settings.colors.pitGlow,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.05, z);
  ring.visible = false;
  return ring;
}
