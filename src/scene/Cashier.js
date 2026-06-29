import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { cloneStorageModel } from './StorageModels.js';
import { buildActionMap, groundModel, tintMesh, updateMixer } from './characterAnim.js';

/**
 * Cashier — a single garage-wide NPC that appears at the cash desk once the
 * cashier is hired (state.hasCashier). Same rigged glTF as the player/mechanics
 * (cloned via SkeletonUtils so it gets its own skeleton + mixer), tinted green
 * (settings.character.cashierTint) and locked to the idle clip forever — it
 * never moves or animates beyond idle. Also drops the cash-register prop
 * (cash-register.glb) at the cashier spot. Render-only.
 */
export class Cashier {
  constructor(gltf, sceneManager) {
    const cfg = settings.character;

    this.root = new THREE.Group();

    this.model = clone(gltf.scene);
    this.model.scale.setScalar(cfg.modelScale);
    this.model.rotation.y = cfg.modelYRotationOffset;
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        tintMesh(o, cfg.cashierTint);
      }
    });
    this.root.add(this.model);
    groundModel(this.model); // sit the model on y=0

    // Stand beside the cash desk, with position + Y-axis facing from settings.
    this.root.position.set(settings.cashier.x, 0, settings.cashier.z);
    this.root.rotation.y = settings.cashier.rotation;

    // The cash register (replaces the old desk/computer prop) lives at its OWN
    // world position/rotation/scale (settings.supermarket.cashRegister*), not
    // parented to the rotated cashier root, so it can be placed independently.
    // Its collision box (gated on hasCashier) is added in core/collision.js.
    const M = settings.supermarket;
    const register = cloneStorageModel('cashRegister');
    register.scale.setScalar(M.cashRegisterScale);
    register.position.set(M.cashRegisterPosition.x, M.cashRegisterPosition.y ?? 0, M.cashRegisterPosition.z);
    register.rotation.y = M.cashRegisterRotation;
    sceneManager.add(register);
    this.register = register;

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = buildActionMap(this.mixer, gltf.animations, cfg.animationMap);
    this.actions.idle?.play(); // idle only — no state changes ever
  }

  update(dt) {
    updateMixer(this.mixer, dt, 'Cashier');
  }
}
