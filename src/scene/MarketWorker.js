import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { attachToHand, buildActionMap, buildTapHitBox, crossfadeTo, groundModel, leanOffsetDelta, lerpAngle, tintMesh, updateMixer } from './characterAnim.js';
import { cloneStorageModel } from './StorageModels.js';
import { ZzzEffect } from './ZzzEffect.js';
import { AlertBounce } from './AlertBounce.js';

const HURRY_TIME_SCALE = 2; // matches Mechanic.js: the active clip plays at double speed while hurrying

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

    this.hitBox = buildTapHitBox(cfg.tapHitRadius, cfg.tapHitHeight);
    this.root.add(this.hitBox);

    this.box = cloneStorageModel('box');
    this.box.scale.setScalar(settings.storage.boxScale);
    this.box.visible = false;
    attachToHand(this.model, this.box, settings.storage.boxHandOffset, settings.storage.boxHandRotation);

    this.bag = cloneStorageModel('bag');
    this.bag.scale.setScalar(settings.supermarket.bagScale);
    this.bag.visible = false;
    attachToHand(this.model, this.bag, settings.supermarket.bagHandOffset, settings.supermarket.bagHandRotation);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = buildActionMap(this.mixer, gltf.animations, cfg.animationMap);
    this.state = 'idle';
    this.actions.idle?.play(); // starts at full weight; no fade-in from nothing

    this.zzz = new ZzzEffect();
    this.zzz.root.position.set(0, cfg.headHeight, 0);
    this.root.add(this.zzz.root);

    this.alertBounce = new AlertBounce(settings.emote.spriteScale);
    this.alertBounce.root.position.set(0, cfg.headHeight + settings.emote.heightAboveHead, 0);
    this.root.add(this.alertBounce.root);
  }

  update(dt, worker) {
    this.root.position.x = worker.position.x;
    this.root.position.z = worker.position.z;
    this.root.position.y = 0;

    if (worker.state === 'onBreak' && !worker.moving) {
      const B = settings.breaks;
      const d = leanOffsetDelta(B.marketBreakSpotFacing, B.leanOffset);
      this.root.position.x += d.x;
      this.root.position.z += d.z;
      this.root.position.y = d.y;
    }
    this.zzz.update(dt, worker.state === 'onBreak' && !worker.moving);
    this.alertBounce.update(dt);

    const t = 1 - Math.exp(-settings.player.turnLerp * dt);
    this.root.rotation.y = lerpAngle(this.root.rotation.y, worker.rotation, t);

    const haulingBox = worker.state === 'restocking' && worker.carrying;

    let next;
    if (worker.state === 'onBreak') {
      next = worker.moving ? 'walkSlow' : 'resting';
    } else if (haulingBox) {
      next = worker.moving ? 'carry' : 'carryIdle';
    } else if (worker.state === 'packaging') {
      next = worker._gatheredItem ? (worker.moving ? 'carry' : 'carryIdle') : worker.moving ? 'walk' : 'idle';
    } else {
      next = worker.moving ? 'walkSlow' : 'idle';
    }
    this.state = crossfadeTo(this.actions, this.state, next, settings.character.crossfadeDuration);

    const activeAction = this.actions[this.state];
    if (activeAction) activeAction.timeScale = worker.hurryTimer > 0 ? HURRY_TIME_SCALE : 1;

    this.box.visible = haulingBox;
    this.bag.visible = worker._gatheredItem;

    updateMixer(this.mixer, dt, 'MarketWorker');
  }
}
