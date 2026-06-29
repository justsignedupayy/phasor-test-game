import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { attachToHand, buildActionMap, crossfadeTo, groundModel, lerpAngle, seatOffsetDelta, tintMesh, updateMixer } from './characterAnim.js';
import { cloneStorageModel } from './StorageModels.js';

/**
 * Mechanic — a worker NPC: the same rigged glTF model as the player (see
 * CharacterModel.js), duplicated per-pit via SkeletonUtils.clone() so each
 * worker gets its own skeleton + AnimationMixer while sharing the original
 * geometry/clips. Tinted (workerTint) so it reads as distinct from the player.
 *
 * Render-only: core/simulation.js owns the mechanic's position + FSM (repair-idle,
 * break-walk to its chair, and the auto-restock box trip), exactly like the market
 * worker (state.supermarket.worker). This class just mirrors that core state each
 * frame — same split as MarketWorker.js. When carrying a restock box it plays the
 * carry clip and shows a Bag/box prop in its hand bone, like the market worker.
 */
const HURRY_TIME_SCALE = 2; // repair clip plays at double speed while hurrying

export class Mechanic {
  constructor(gltf) {
    const cfg = settings.character;

    this.root = new THREE.Group();

    this.model = clone(gltf.scene);
    this.model.scale.setScalar(cfg.modelScale);
    this.model.rotation.y = cfg.modelYRotationOffset;
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        tintMesh(o, cfg.workerTint);
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

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = buildActionMap(this.mixer, gltf.animations, cfg.animationMap);
    this.state = 'idle';
    this.actions.idle?.play(); // starts at full weight; no fade-in from nothing
  }

  /**
   * @param {object} flags
   * @param {object} flags.mechanic   core's pit.mechanic (position/rotation/moving/carrying)
   * @param {boolean} flags.carPresent a car is in the pit to work on
   * @param {boolean} flags.hurrying   a remote-hurry boost is active
   * @param {boolean} flags.onBreak    core break flag for this pit's worker
   * @param {number} flags.chairFacing the Y-facing the seated worker holds
   * @param {object} flags.seatOffset  per-seat sit offset (chair vs couch)
   */
  update(dt, { mechanic, carPresent, hurrying, onBreak, chairFacing, seatOffset }) {
    if (!mechanic) {
      updateMixer(this.mixer, dt, 'Mechanic');
      return;
    }

    this.root.position.x = mechanic.position.x;
    this.root.position.z = mechanic.position.z;
    this.root.position.y = 0;

    // Once seated on break, nudge the body onto the seat (the same per-seat-type
    // offset the market worker uses) so it rests ON it instead of clipping into the
    // bulkier couch. Pure render offset — core's mechanic.position is unchanged.
    if (onBreak && !mechanic.moving) {
      const d = seatOffsetDelta(chairFacing, seatOffset);
      this.root.position.x += d.x;
      this.root.position.z += d.z;
      this.root.position.y = d.y;
    }

    const t = 1 - Math.exp(-settings.player.turnLerp * dt);
    this.root.rotation.y = lerpAngle(this.root.rotation.y, mechanic.rotation, t);

    // Animation: seated on break; carrying a box on the restock haul (carry clip);
    // walking en route; otherwise repair/idle at the work spot.
    let next;
    if (onBreak) next = mechanic.moving ? 'walk' : 'sitting';
    else if (mechanic.carrying) next = mechanic.moving ? 'carry' : 'carryIdle';
    else if (mechanic.moving) next = 'walk';
    else next = carPresent ? 'repair' : 'idle';
    this.state = crossfadeTo(this.actions, this.state, next, settings.character.crossfadeDuration);

    const repairAction = this.actions.repair;
    if (repairAction) repairAction.timeScale = hurrying ? HURRY_TIME_SCALE : 1;

    this.box.visible = mechanic.carrying;

    updateMixer(this.mixer, dt, 'Mechanic');
  }
}
