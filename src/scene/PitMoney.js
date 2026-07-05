import * as THREE from 'three';
import settings from '../config/settings.js';
import { showCashPopup } from './popup.js';
import { formatMoney } from '../core/format.js';
import { preloadMoneyModel, moneyModel, spawnFlyingBills } from './MoneyFly.js';

export { preloadMoneyModel };

/**
 * PitMoney — per-pit pay made visible. While a pit holds uncollected pay
 * (pit.pendingCash > 0), a small stack of bills sits on its floor; the height
 * tracks the amount (≈ pendingCash / cashPerBill, capped). Core owns the money:
 * it banks pendingCash into cash the moment the player is near (or instantly
 * with a cashier). This view only mirrors the number and, when pendingCash
 * drops to 0, flies the bills to the player and pops the "+$" — i.e. the popup
 * appears exactly when money is actually collected, never at repair-finish.
 *
 * Render-only: reads core state, writes nothing back.
 */
export class PitMoney {
  /**
   * Defaults to the repair pits; the gas station reuses this 1:1 by passing its
   * own positions + a selector for its pump list (pumps carry the same
   * pendingCash / collectedThisTick shape as pits).
   */
  constructor(sceneManager, positions = settings.pit.positions, getSlots = (state) => state.pits) {
    this.sm = sceneManager;
    this.positions = positions;
    this.getSlots = getSlots;
    // One slot per pit: its stacked bills, the last pendingCash we saw (to catch
    // the drop-to-0 collection event), and any in-flight collection animation.
    this.slots = positions.map((pos) => ({
      base: { x: pos.x + 1.5, y: 0.1, z: pos.z + 1.3 }, // front-right of the pad, clear of the car
      bills: [],
      prevPending: 0,
      flyController: null,
    }));
  }

  update(dt, state, playerPos) {
    if (!moneyModel) return; // not loaded yet
    this.getSlots(state).forEach((pit, i) => this.#updateSlot(dt, this.slots[i], pit, playerPos));
  }

  #updateSlot(dt, slot, pit, playerPos) {
    if (slot.flyController) {
      slot.flyController.update(dt);
      if (slot.flyController.done) slot.flyController = null;
      return;
    }

    const pending = pit.pendingCash;

    // Collection event. Primary signal: core banked money this tick
    // (collectedThisTick). Fallback: pending dropped to 0 some other way (e.g.
    // hiring the cashier sweeps every pit's waiting pile straight to cash).
    const collected =
      pit.collectedThisTick > 0 ? pit.collectedThisTick : slot.prevPending > 0 && pending === 0 ? slot.prevPending : 0;
    if (collected > 0) {
      const pos = this.positions[pit.index];
      this.#popup(collected, pos);
      slot.prevPending = 0;
      if (slot.bills.length > 0) {
        const fromPositions = slot.bills.map((b) => b.position.clone());
        for (const bill of slot.bills) disposeBill(this.sm, bill);
        slot.bills = [];
        slot.flyController = spawnFlyingBills(
          this.sm,
          fromPositions.length,
          fromPositions,
          { x: playerPos.x, z: playerPos.z },
          { stagger: 0 } // original behavior: every bill flies in lockstep, no stagger
        );
      }
      return;
    }
    slot.prevPending = pending;

    // Reconcile the visible stack to the waiting amount.
    const target = pending > 0 ? Math.min(settings.money.maxBills, Math.ceil(pending / settings.money.cashPerBill)) : 0;
    while (slot.bills.length < target) slot.bills.push(this.#spawnBill(slot, slot.bills.length));
    while (slot.bills.length > target) disposeBill(this.sm, slot.bills.pop());
  }

  #spawnBill(slot, i) {
    const bill = moneyModel.clone();
    bill.scale.setScalar(settings.money.billScale);
    bill.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    bill.position.set(slot.base.x, slot.base.y + i * settings.money.billSpacing, slot.base.z);
    this.sm.add(bill);
    return bill;
  }

  #popup(amount, pos) {
    const v = new THREE.Vector3(pos.x, 1.6, pos.z).project(this.sm.camera);
    const rect = this.sm.renderer.domElement.getBoundingClientRect();
    const x = (v.x * 0.5 + 0.5) * rect.width + rect.left;
    const y = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
    showCashPopup(`+$${formatMoney(amount)}`, x, y);
  }
}

// A bill is a plain clone of the shared Money.glb base: its geometry AND
// materials belong to that session-lifetime base (nothing is cloned per bill —
// no per-instance mutation needs it; the green tint is applied once at preload).
// So a despawned bill only leaves the scene — disposing here would yank the
// shared GPU resources out from under every bill still stacked at other pits
// (the shared-resource hazard CarView.dispose documents).
function disposeBill(sceneManager, bill) {
  sceneManager.remove(bill);
}
