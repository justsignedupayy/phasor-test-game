import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { attachToHand, buildActionMap, buildTapHitBox, crossfadeTo, groundModel, leanOffsetDelta, lerpAngle, tintMesh, updateMixer } from './characterAnim.js';
import { cloneStorageModel } from './StorageModels.js';
import { ZzzEffect } from './ZzzEffect.js';
import { AlertBounce } from './AlertBounce.js';

const HURRY_TIME_SCALE = 2; // repair clip plays at double speed while hurrying

export class Mechanic {
  constructor(gltf, tint = settings.character.workerTint, workClip = 'repair') {
    const cfg = settings.character;
    this.workClip = workClip;

    this.root = new THREE.Group();

    this.model = clone(gltf.scene);
    this.model.scale.setScalar(cfg.modelScale);
    this.model.rotation.y = cfg.modelYRotationOffset;
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        tintMesh(o, tint);
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

    this.wrench = cloneStorageModel('wrench');
    this.wrench.scale.setScalar(cfg.wrenchOffset.scale);
    this.wrench.visible = false;
    attachToHand(this.model, this.wrench, cfg.wrenchOffset.offset, cfg.wrenchOffset.rotation, 'l');

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

  update(dt, { mechanic, carPresent, hurrying, onBreak, restFacing, leanOffset }) {
    if (!mechanic) {
      this.alertBounce.update(dt);
      updateMixer(this.mixer, dt, 'Mechanic');
      return;
    }

    this.root.position.x = mechanic.position.x;
    this.root.position.z = mechanic.position.z;
    this.root.position.y = 0;

    if (onBreak && !mechanic.moving) {
      const d = leanOffsetDelta(restFacing, leanOffset);
      this.root.position.x += d.x;
      this.root.position.z += d.z;
      this.root.position.y = d.y;
    }
    this.zzz.update(dt, onBreak && !mechanic.moving);
    this.alertBounce.update(dt);

    const t = 1 - Math.exp(-settings.player.turnLerp * dt);
    this.root.rotation.y = lerpAngle(this.root.rotation.y, mechanic.rotation, t);

    let next;
    if (onBreak) next = mechanic.moving ? 'walk' : 'resting';
    else if (mechanic.carrying) next = mechanic.moving ? 'carry' : 'carryIdle';
    else if (mechanic.moving) next = 'walk';
    else next = carPresent ? this.workClip : 'idle';
    this.state = crossfadeTo(this.actions, this.state, next, settings.character.crossfadeDuration);
    this.wrench.visible = this.state === 'repair';

    const workAction = this.actions[this.workClip];
    if (workAction) workAction.timeScale = hurrying ? HURRY_TIME_SCALE : 1;

    this.box.visible = mechanic.carrying;

    updateMixer(this.mixer, dt, 'Mechanic');
  }
}
