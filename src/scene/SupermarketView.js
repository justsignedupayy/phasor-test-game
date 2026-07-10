import * as THREE from 'three';
import settings from '../config/settings.js';
import { cloneStorageModel } from './StorageModels.js';
import { MarketWorker } from './MarketWorker.js';
import { MarketCustomer } from './MarketCustomer.js';
import { TruckView } from './TruckView.js';
import { showCashPopup } from './popup.js';
import { formatMoney } from '../core/format.js';
import { deliverStock, truckDeliveryTime } from '../core/supermarket.js';
import { getProductImage } from './productImages.js';
import { LedDisplay, formatMmSs } from './BreakDisplay.js';

/**
 * SupermarketView — the whole shop's render layer: 4 shelves (shelf_end.glb /
 * freezers_standing.glb) with a live stock label, a checkout counter + Bag.glb
 * (shown only once a finished order is placed there), the outside restock
 * pile, every customer NPC, and the market worker once hired. No game logic;
 * everything here mirrors state.supermarket. Tap targets (shelf/checkout/
 * restock pile) are exposed via raycastTap() for main.js to dispatch into
 * core/supermarket.js, same split as CarYard.raycast() + PitView's rings.
 */
const RING_PULSE_HZ = 5; // matches PitView's highlight pulse

export class SupermarketView {
  constructor(sceneManager, gltf) {
    this.sm = sceneManager;
    this.gltf = gltf;

    this.worker = null; // MarketWorker, spawned once workerLevel >= 1
    this.customers = new Map(); // customerId -> MarketCustomer
    this.highlightT = 0;

    this.truck = new TruckView(sceneManager); // single reused Truck.glb instance

    this.#buildShelves();
    this.#buildCheckout();
    this.#buildRestockPile();
    this.#buildCarriedBox();
    this.#buildTruckDisplay();
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

      const label = makeLabelSprite(1.75);
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

    // The live "X/4" stock readout lives on the wall-mounted delivery LED
    // (#buildTruckDisplay); no floating label over the box is needed.
    this.restockRing = makeRing(pos.x, pos.z);
    this.sm.add(this.restockRing);
  }

  /**
   * The delivery-status LED panel: the break panels' wall fixture (LedDisplay)
   * reused on the LEFT wall of the delivery corridor, halfway down it, at the
   * break panels' mounting height, facing into the corridor (+x). Green LEDs
   * (settings.supermarket.truck.display) so it reads as delivery info, not a
   * break clock. Content is set in update(): restock stock "units/max" while
   * idle, the mm:ss countdown while a truck order is pending.
   */
  #buildTruckDisplay() {
    const W = settings.world;
    const S = settings.supermarket;
    const D = settings.breaks.display;
    const corridorStart = -(W.halfZ + W.wallThickness); // the building wall's outer face
    this.truckDisplay = new LedDisplay({
      x: S.deliveryDoorX - W.gateHalf + D.wallInset, // the corridor's left wall, inner face
      y: D.y,
      z: (corridorStart + S.deliveryDoorZ) / 2,
      rotationY: Math.PI / 2,
      ledColor: S.truck.display.ledColor,
      ledOffColor: S.truck.display.ledOffColor,
    });
    this.sm.add(this.truckDisplay.group);
  }

  /** The box the PLAYER (manual restocking) carries from the pile to a shelf. */
  #buildCarriedBox() {
    this.carriedBox = cloneStorageModel('box');
    this.carriedBox.scale.setScalar(settings.storage.boxScale);
    this.carriedBox.visible = false;
    this.sm.add(this.carriedBox);
  }

  /** Tap raycast against the worker/shelves/checkout/restock pile; null if nothing hit. */
  raycastTap(raycaster) {
    if (this.worker && raycaster.intersectObject(this.worker.model, true).length > 0) {
      return { kind: 'worker' };
    }
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

  /** True if the market worker's model was hit AND the worker is on break. */
  raycastRestingWorker(raycaster, state) {
    const w = state.supermarket.worker;
    if (!this.worker || !w || !w.break.onBreak) return false;
    return raycaster.intersectObject(this.worker.model, true).length > 0;
  }

  update(dt, state) {
    const S = state.supermarket;
    const unlocked = S.unlocked;

    for (const shelf of this.shelves) {
      shelf.model.visible = unlocked;
      shelf.label.visible = unlocked;
      if (!unlocked) continue;
      const stateShelf = S.shelves[shelf.index];
      const stockText = `${stateShelf.stock}/${settings.supermarket.shelfCapacity}`;
      // The photo-loaded flag is part of the cache key so the label re-draws
      // once, swapping the letter fallback for the image when it arrives.
      const key = `${stateShelf.productType}|${stockText}|${getProductImage(stateShelf.productType) ? 1 : 0}`;
      if (key !== shelf.labelText) {
        shelf.labelText = key;
        drawShelfLabelSprite(shelf.label, stateShelf.productType, stockText);
      }
    }

    this.checkoutCounter.visible = unlocked;
    this.bag.visible = unlocked && !!S.checkoutBag;
    for (const box of this.pileBoxes) box.visible = unlocked;
    // The pile mesh stays decorative; its "X/maxUnits" stock readout is shown on
    // the wall-mounted delivery LED (truckDisplay) below, not a floating label.

    // Delivery truck: core flags an arrival; play the drive-in (which tops up the
    // box via deliverStock at touchdown), then the drive-out. Single reused instance.
    if (S.truckArriving && this.truck.idle) this.truck.arrive(() => deliverStock(state));
    this.truck.update(dt);

    // Delivery-status LED panel: mm:ss to arrival while an order is pending,
    // the restock box's stock the rest of the time (including while the truck
    // itself is in flight — the order clock is done by then).
    if (!unlocked) this.truckDisplay.hide();
    else if (S.truckOrdered) this.truckDisplay.setText(formatMmSs(truckDeliveryTime(state) - S.truckTimer));
    else this.truckDisplay.setText(`${S.restockBox.units}/${S.restockBox.maxUnits}`);

    if (S.paidThisTick > 0) this.#popup(S.paidThisTick, settings.supermarket.checkoutPosition);

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

    const canGrabBox =
      S.unlocked &&
      S.workerLevel < 2 &&
      S.restockBox.units > 0 &&
      !player.carryingRestockBox &&
      !player.carryingBox && // pickup is refused while hauling a pit tire box (main.js), so don't advertise it
      near(S.restockBoxPosition);
    this.restockRing.visible = S.unlocked;
    this.restockRing.material.opacity += ((canGrabBox ? pulse : 0) - this.restockRing.material.opacity) * k;
  }

  /** Pops "+$" over the checkout the instant a customer pays, mirroring CarYard/PitMoney's popup. */
  #popup(amount, pos) {
    const v = new THREE.Vector3(pos.x, 1.6, pos.z).project(this.sm.camera);
    const rect = this.sm.renderer.domElement.getBoundingClientRect();
    const x = (v.x * 0.5 + 0.5) * rect.width + rect.left;
    const y = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
    showCashPopup(`+$${formatMoney(amount)}`, x, y);
  }
}

// A camera-facing text label rendered to a small canvas texture (mirrors PitView's
// storage label). scaleMult sizes the whole sprite up around the same anchor point —
// the shelf signs pass 1.75 for their product photos; the restock counter stays at 1.
function makeLabelSprite(scaleMult = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(2.2 * scaleMult, 0.55 * scaleMult, 1);
  sprite.userData.canvas = canvas;
  sprite.userData.tex = tex;
  return sprite;
}

/**
 * Shelf sign: the product's photo (its letter until the photo loads) followed
 * by the live "stock/capacity" count, centered together on the canvas.
 */
function drawShelfLabelSprite(sprite, productType, stockText) {
  const canvas = sprite.userData.canvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = settings.colors.label;
  ctx.font = `800 30px ${settings.ui.fontStack}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;

  const IMG = 52; // square photo edge, inside the 64px-high canvas
  const GAP = 10; // photo-to-count
  const img = getProductImage(productType);
  const leadWidth = img ? IMG : ctx.measureText(productType).width;
  let x = (canvas.width - (leadWidth + GAP + ctx.measureText(stockText).width)) / 2;
  const midY = canvas.height / 2;
  if (img) ctx.drawImage(img, x, midY - IMG / 2, IMG, IMG);
  else ctx.fillText(productType, x, midY + 2);
  ctx.fillText(stockText, x + leadWidth + GAP, midY + 2);
  sprite.userData.tex.needsUpdate = true;
}

function drawLabelSprite(sprite, text) {
  const canvas = sprite.userData.canvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = settings.colors.label;
  ctx.font = `800 30px ${settings.ui.fontStack}`;
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
