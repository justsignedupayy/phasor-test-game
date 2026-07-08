import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { attachToHand, buildActionMap, crossfadeTo, groundModel, leanOffsetDelta, lerpAngle, tintMesh, updateMixer } from './characterAnim.js';
import { cloneStorageModel } from './StorageModels.js';
import { ZzzEffect } from './ZzzEffect.js';
import { AlertBounce } from './AlertBounce.js';
import { BreakLabel } from './BreakLabel.js';

/**
 * Mechanic — a worker NPC: the same rigged glTF model as the player (see
 * CharacterModel.js), duplicated per-pit via SkeletonUtils.clone() so each
 * worker gets its own skeleton + AnimationMixer while sharing the original
 * geometry/clips. Tinted (workerTint) so it reads as distinct from the player.
 *
 * Render-only: core/simulation.js owns the mechanic's position + FSM (repair-idle,
 * break-walk to its wall-lean spot, and the auto-restock box trip), exactly like the
 * market worker (state.supermarket.worker). This class just mirrors that core state each
 * frame — same split as MarketWorker.js. When carrying a restock box it plays the
 * carry clip and shows a Bag/box prop in its hand bone, like the market worker.
 */
const HURRY_TIME_SCALE = 2; // repair clip plays at double speed while hurrying

export class Mechanic {
  /**
   * `workClip` is the animation state played while working on a present car —
   * 'repair' for pit mechanics (the default, unchanged), 'gaspump' for pump
   * attendants (see scene/GasStationView.js).
   */
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

    // The cardboard box carried on an auto-restock haul (shelf → pit), attached to
    // the hand bone so it tracks the carry animation — exactly like the market worker.
    this.box = cloneStorageModel('box');
    this.box.scale.setScalar(settings.storage.boxScale);
    this.box.visible = false;
    attachToHand(this.model, this.box, settings.storage.boxHandOffset, settings.storage.boxHandRotation);

    // The wrench held while repairing (pit mechanics only — pump attendants use
    // the 'gaspump' clip and never reach the 'repair' state, see update() below).
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

    // Red exclamation-mark bounce shown on a remote hurry tap (see main.js).
    this.alertBounce = new AlertBounce(settings.emote.spriteScale);
    this.alertBounce.root.position.set(0, cfg.headHeight + settings.emote.heightAboveHead, 0);
    this.root.add(this.alertBounce.root);

    // "x/y" break-progress counter floating above the head (hidden on break —
    // the Zzz effect takes its place there).
    this.breakLabel = new BreakLabel();
    this.breakLabel.sprite.position.set(0, cfg.headHeight + 0.35, 0);
    this.root.add(this.breakLabel.sprite);
  }

  /**
   * @param {object} flags
   * @param {object} flags.mechanic   core's pit.mechanic (position/rotation/moving/carrying)
   * @param {boolean} flags.carPresent a car is in the pit to work on
   * @param {boolean} flags.hurrying   a remote-hurry boost is active
   * @param {boolean} flags.onBreak    core break flag for this pit's worker
   * @param {object} flags.breakState  core break counter (pit.break / pump.break) for the head label
   * @param {number} flags.restFacing  the Y-facing the resting worker holds
   * @param {object} flags.leanOffset  the break-spot lean offset
   */
  update(dt, { mechanic, carPresent, hurrying, onBreak, breakState, restFacing, leanOffset }) {
    if (!mechanic) {
      this.breakLabel.update(null);
      this.alertBounce.update(dt);
      updateMixer(this.mixer, dt, 'Mechanic');
      return;
    }
    this.breakLabel.update(breakState);

    this.root.position.x = mechanic.position.x;
    this.root.position.z = mechanic.position.z;
    this.root.position.y = 0;

    // Once on break, nudge the body onto its break spot (the same lean offset the
    // market worker uses) so it leans upright against the wall. Pure render
    // offset — core's mechanic.position is unchanged.
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

    // Animation: resting on break; carrying a box on the restock haul (carry clip);
    // walking en route; otherwise repair/idle at the work spot.
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
