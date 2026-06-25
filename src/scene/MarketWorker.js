import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildActionMap, crossfadeTo, groundModel, lerpAngle, tintMesh, updateMixer } from './characterAnim.js';

/**
 * MarketWorker — the supermarket's worker NPC (state.supermarket.workerLevel
 * >= 1): the same rigged glTF as the player/mechanics, cloned + tinted
 * (marketWorkerTint) like Mechanic.js. Unlike Mechanic (which never leaves its
 * pit), this one actually walks: core/supermarket.js owns its position/
 * rotation/state each tick, this class only renders it — same split as
 * Character.js mirroring state.player.
 */
export class MarketWorker {
  constructor(gltf) {
    const cfg = settings.character;

    this.root = new THREE.Group();

    this.model = clone(gltf.scene);
    this.model.scale.setScalar(cfg.modelScale);
    this.model.rotation.y = cfg.modelYRotationOffset;
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        tintMesh(o, cfg.marketWorkerTint);
      }
    });
    this.root.add(this.model);
    groundModel(this.model); // the model's mesh origin isn't at floor level — sit it on y=0

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = buildActionMap(this.mixer, gltf.animations, cfg.animationMap);
    this.state = 'idle';
    this.actions.idle?.play(); // starts at full weight; no fade-in from nothing
  }

  /** @param {object} worker core's state.supermarket.worker */
  update(dt, worker) {
    this.root.position.x = worker.position.x;
    this.root.position.z = worker.position.z;

    const t = 1 - Math.exp(-settings.player.turnLerp * dt);
    this.root.rotation.y = lerpAngle(this.root.rotation.y, worker.rotation, t);

    // Carrying the bag (packaging) or a restock box overrides walk/idle with
    // carry/carryIdle for as long as it lasts — mirrors the player's carry flow.
    // Plain walking uses 'walkSlow' (not the run-paced 'walk') since the
    // worker moves well under run speed — see settings.supermarket.workerMoveSpeed.
    const next = worker.carrying ? (worker.moving ? 'carry' : 'carryIdle') : worker.moving ? 'walkSlow' : 'idle';
    this.state = crossfadeTo(this.actions, this.state, next, settings.character.crossfadeDuration);

    updateMixer(this.mixer, dt, 'MarketWorker');
  }
}
