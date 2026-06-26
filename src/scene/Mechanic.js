import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildActionMap, crossfadeTo, groundModel, lerpAngle, seatOffsetDelta, tintMesh, updateMixer } from './characterAnim.js';

/**
 * Mechanic — a worker NPC: the same rigged glTF model as the player (see
 * CharacterModel.js), duplicated per-pit via SkeletonUtils.clone() so each
 * worker gets its own skeleton + AnimationMixer while sharing the original
 * geometry/clips. Tinted (workerTint) so it reads as distinct from the player.
 * Render-only; driven by update(dt, flags).
 *
 * Unlike the market worker (whose position is core-owned), the mechanic is a
 * stationary NPC with no core position — it just stands beside its pit. Its one
 * bit of travel, walking to/from its break chair, is therefore a purely visual
 * transition driven here off the core break flag (pit.break.onBreak): the path
 * pit↔chair is short and obstacle-free, so a straight lerp suffices. The break
 * CLOCK (the actual game logic) lives entirely in core/breaks.js.
 */
const HURRY_TIME_SCALE = 2; // repair clip plays at double speed while hurrying
const ARRIVE_EPS = 0.05; // distance under which it counts as parked at a spot

export class Mechanic {
  /** @param {{x:number,z:number}} pitPos world position of the pit this worker serves */
  constructor(pitPos, gltf) {
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

    // Stand beside the pit, facing the car (the work spot it returns to off-break).
    this.workPos = { x: pitPos.x + settings.mechanic.offsetX, z: pitPos.z + settings.mechanic.offsetZ };
    this.workFacing = Math.atan2(pitPos.x - this.workPos.x, pitPos.z - this.workPos.z) + settings.mechanic.facingOffset;
    this.root.position.set(this.workPos.x, 0, this.workPos.z);
    this.root.rotation.y = this.workFacing;

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = buildActionMap(this.mixer, gltf.animations, cfg.animationMap);
    this.state = 'idle';
    this.actions.idle?.play(); // starts at full weight; no fade-in from nothing
  }

  /**
   * @param {object} flags
   * @param {boolean} flags.carPresent  a car is in the pit to work on
   * @param {boolean} flags.hurrying    a remote-hurry boost is active
   * @param {boolean} flags.onBreak     core break flag for this pit's worker
   * @param {{x:number,z:number}} flags.chairPos  where the break chair sits
   * @param {number} flags.chairFacing  the Y-facing the seated worker holds
   */
  update(dt, { carPresent, hurrying, onBreak, chairPos, chairFacing, seatOffset }) {
    // Travel: walk toward the seat (offset onto the cushion) while on break, back
    // to the work spot otherwise. The seat offset keeps the body resting ON the
    // seat instead of clipping into its frame (see settings.breaks.sitOffset).
    const d = seatOffsetDelta(chairFacing, seatOffset);
    const seatX = chairPos.x + d.x;
    const seatZ = chairPos.z + d.z;
    const target = onBreak ? { x: seatX, z: seatZ } : this.workPos;
    const dx = target.x - this.root.position.x;
    const dz = target.z - this.root.position.z;
    const dist = Math.hypot(dx, dz);
    const atTarget = dist <= ARRIVE_EPS;

    if (!atTarget) {
      const step = Math.min(dist, settings.breaks.mechanicWalkSpeed * dt);
      this.root.position.x += (dx / dist) * step;
      this.root.position.z += (dz / dist) * step;
    }

    // Lift onto the cushion only once actually seated (0 while walking there/back).
    const t = 1 - Math.exp(-settings.player.turnLerp * dt);
    const targetY = atTarget && onBreak ? d.y : 0;
    this.root.position.y += (targetY - this.root.position.y) * t;

    // Facing: turn toward travel while walking, else into the seat / toward the car.
    const faceTarget = !atTarget ? Math.atan2(dx, dz) : onBreak ? chairFacing : this.workFacing;
    this.root.rotation.y = lerpAngle(this.root.rotation.y, faceTarget, t);

    // Animation: walking en route, seated once parked at the chair, otherwise
    // the usual repair/idle at the work spot.
    let next;
    if (!atTarget) next = 'walk';
    else if (onBreak) next = 'sitting';
    else next = carPresent ? 'repair' : 'idle';
    this.state = crossfadeTo(this.actions, this.state, next, settings.character.crossfadeDuration);

    const repairAction = this.actions.repair;
    if (repairAction) repairAction.timeScale = hurrying ? HURRY_TIME_SCALE : 1;

    updateMixer(this.mixer, dt, 'Mechanic');
  }
}
