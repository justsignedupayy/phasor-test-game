import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { cloneStorageModel } from './StorageModels.js';
import { buildActionMap, groundModel, tintMesh, updateMixer } from './characterAnim.js';

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

    this.root.position.set(settings.cashier.x, 0, settings.cashier.z);
    this.root.rotation.y = settings.cashier.rotation;

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
