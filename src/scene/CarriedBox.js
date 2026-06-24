import settings from '../config/settings.js';
import { cloneStorageModel } from './StorageModels.js';

/**
 * CarriedBox — the single box clone shown floating just ahead of the player
 * while state.player.carryingBox is true (the player hauls it from a shelf to a
 * worker). Render-only: it mirrors core state and writes nothing back. Hidden
 * whenever the player isn't carrying.
 */
export class CarriedBox {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.root = cloneStorageModel('box');
    this.root.scale.setScalar(settings.storage.boxScale);
    this.root.visible = false;
    sceneManager.add(this.root);
  }

  update(player) {
    if (!player.carryingBox) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    // Offset along the player's facing (rotation 0 faces +z) so the box sits
    // out in front of the character rather than inside it.
    const o = settings.storage.carriedBoxOffset;
    const fwdX = Math.sin(player.rotation);
    const fwdZ = Math.cos(player.rotation);
    this.root.position.set(
      player.position.x + fwdX * o.forward,
      o.y,
      player.position.z + fwdZ * o.forward
    );
    this.root.rotation.y = player.rotation;
  }
}
