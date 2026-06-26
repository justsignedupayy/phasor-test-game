import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { attachToHand, buildActionMap, crossfadeTo, groundModel, lerpAngle, seatOffsetDelta, tintMesh, updateMixer } from './characterAnim.js';
import { cloneStorageModel } from './StorageModels.js';

/**
 * MarketWorker — the supermarket's worker NPC (state.supermarket.workerLevel
 * >= 1): the same rigged glTF as the player/mechanics, cloned + tinted
 * (marketWorkerTint) like Mechanic.js. Unlike Mechanic (which never leaves its
 * pit), this one actually walks: core/supermarket.js owns its position/
 * rotation/state each tick, this class only renders it — same split as
 * Character.js mirroring state.player.
 */
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

    // Two independently-toggled hand props, both parented to the hand bone so
    // they track the carry animation:
    //  • a cardboard box on a restock haul (pile → shelf), sized like the
    //    player's carried box (settings.storage.boxScale);
    //  • a Bag.glb holding the order while packaging.
    // Only one is ever visible at a time (the worker can't restock and package
    // at once), but each is shown/hidden by its own state below.
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
  }

  /** @param {object} worker core's state.supermarket.worker */
  update(dt, worker) {
    this.root.position.x = worker.position.x;
    this.root.position.z = worker.position.z;
    this.root.position.y = 0;

    // Once seated on break, nudge the body onto the seat (the same per-seat-type
    // offset the mechanics use) so it rests ON it instead of clipping into the
    // bulkier couch. Pure render offset — core's worker.position is unchanged.
    if (worker.state === 'onBreak' && !worker.moving) {
      const B = settings.breaks;
      const off = worker.break.breakDurationUpgraded ? B.sitOffset.couch : B.sitOffset.chair;
      const d = seatOffsetDelta(B.marketChairFacing, off);
      this.root.position.x += d.x;
      this.root.position.z += d.z;
      this.root.position.y = d.y;
    }

    const t = 1 - Math.exp(-settings.player.turnLerp * dt);
    this.root.rotation.y = lerpAngle(this.root.rotation.y, worker.rotation, t);

    // On a RESTOCK haul the worker carries the cardboard box from the pile to the
    // shelf — carry clip + visible box — once it has actually picked it up
    // (worker.carrying flips true on arrival at the pile).
    const haulingBox = worker.state === 'restocking' && worker.carrying;

    // Animation: restock haul → carry. While packaging, gate on core's
    // worker._gatheredItem — empty-handed (false) is the run-paced sprint to the
    // first shelf ('walk'); once it holds ≥1 item (true) it switches to 'carry'
    // for the rest of the trip. Everything else uses the walking-pace 'walkSlow'.
    let next;
    if (worker.state === 'onBreak') {
      // Walks (empty-handed) to its chair, then sits for the break's duration.
      next = worker.moving ? 'walkSlow' : 'sitting';
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

    // Props: the cardboard box shows on a restock haul; the order bag shows while
    // packaging once an item is in hand — both gated on the same flags that drive
    // the animation. worker._gatheredItem is only ever true mid-packaging-trip.
    this.box.visible = haulingBox;
    this.bag.visible = worker._gatheredItem;

    updateMixer(this.mixer, dt, 'MarketWorker');
  }
}
