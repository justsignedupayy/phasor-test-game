import settings from '../config/settings.js';
import { laneBridgeElevationAt } from '../core/roads.js';
import { cloneStorageModel } from './StorageModels.js';

export class CarriedBox {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.root = cloneStorageModel('box');
    this.root.scale.setScalar(settings.storage.boxScale);
    this.root.visible = false;
    sceneManager.add(this.root);
  }

  update(player, state) {
    if (!player.carryingBox) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    const o = settings.storage.carriedBoxOffset;
    const fwdX = Math.sin(player.rotation);
    const fwdZ = Math.cos(player.rotation);
    this.root.position.set(
      player.position.x + fwdX * o.forward,
      o.y + laneBridgeElevationAt(state, player.position.x, player.position.z),
      player.position.z + fwdZ * o.forward
    );
    this.root.rotation.y = player.rotation;
  }
}
