import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildActionMap, groundModel, tintMesh, updateMixer } from './characterAnim.js';

/**
 * Cashier — a single garage-wide NPC that appears at the cash desk once the
 * cashier is hired (state.hasCashier). Same rigged glTF as the player/mechanics
 * (cloned via SkeletonUtils so it gets its own skeleton + mixer), tinted green
 * (settings.character.cashierTint) and locked to the idle clip forever — it
 * never moves or animates beyond idle. Render-only.
 */
export class Cashier {
  constructor(gltf) {
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

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = buildActionMap(this.mixer, gltf.animations, cfg.animationMap);
    this.actions.idle?.play(); // idle only — no state changes ever
  }

  update(dt) {
    updateMixer(this.mixer, dt, 'Cashier');
  }
}
