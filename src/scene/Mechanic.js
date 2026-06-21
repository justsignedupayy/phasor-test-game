import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildActionMap, crossfadeTo, groundModel, updateMixer } from './characterAnim.js';

/**
 * Mechanic — a worker NPC: the same rigged glTF model as the player (see
 * CharacterModel.js), duplicated per-pit via SkeletonUtils.clone() so each
 * worker gets its own skeleton + AnimationMixer while sharing the original
 * geometry/clips. Tinted (workerTint) so it reads as distinct from the player.
 * Render-only; driven by update(dt, flags).
 */
const HURRY_TIME_SCALE = 2; // repair clip plays at double speed while hurrying

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

    // Stand beside the pit, facing the car.
    const px = pitPos.x + settings.mechanic.offsetX;
    const pz = pitPos.z + settings.mechanic.offsetZ;
    this.root.position.set(px, 0, pz);
    this.root.rotation.y = Math.atan2(pitPos.x - px, pitPos.z - pz);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = buildActionMap(this.mixer, gltf.animations, cfg.animationMap);
    this.state = 'idle';
    this.actions.idle?.play(); // starts at full weight; no fade-in from nothing
  }

  update(dt, { carPresent, hurrying }) {
    const next = carPresent ? 'repair' : 'idle';
    this.state = crossfadeTo(this.actions, this.state, next, settings.character.crossfadeDuration);

    const repairAction = this.actions.repair;
    if (repairAction) repairAction.timeScale = hurrying ? HURRY_TIME_SCALE : 1;

    updateMixer(this.mixer, dt, 'Mechanic');
  }
}

// Clones (so workers don't share/mutate the player's or each other's material) and
// recolors a mesh's material(s). Materials without a `.color` (e.g. some custom
// shaders) are left as-is — see PitView/Mechanic callers for the ring-marker fallback.
function tintMesh(mesh, color) {
  if (!mesh.material) return;
  const wasArray = Array.isArray(mesh.material);
  const materials = wasArray ? mesh.material : [mesh.material];
  const tinted = materials.map((m) => {
    const t = m.clone();
    if (t.color) t.color.set(color);
    return t;
  });
  mesh.material = wasArray ? tinted : tinted[0];
}
