import { MathUtils } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * CharacterModel.js — the rigged character is split across four Mixamo
 * exports, one animation each: character_idle.glb (mesh + skeleton + idle
 * clip), character_run.glb (run clip), character_repair.glb (repair clip),
 * and character_yell.glb (yell clip), all sharing the same skeleton. They
 * load exactly once and are merged into a single gltf-shaped
 * { scene, animations } result — idle's scene as the base, clips renamed to
 * 'idle'/'walk'/'repair'/'yell' — so the player and every worker clone share
 * one fetched/parsed asset (see Character.js + Mechanic.js, which build
 * their own AnimationMixer off gltf.scene/animations).
 */
let pending = null;

// Strip root motion: this skeleton bakes forward translation into the
// rootx/root bones' position tracks, which would slide the whole character
// across the floor on top of our own movement code. Removing them leaves the
// quaternion/scale tracks intact so the clip still plays in place.
function stripRootMotion(clip) {
  clip.tracks = clip.tracks.filter((track) => track.name !== 'rootx.position' && track.name !== 'root.position');
}

export function loadCharacterModel() {
  if (!pending) {
    const loader = new GLTFLoader();
    pending = Promise.all([
      loader.loadAsync('/models/character_idle.glb'),
      loader.loadAsync('/models/character_run.glb'),
      loader.loadAsync('/models/character_repair.glb'),
      loader.loadAsync('/models/character_yell.glb'),
    ]).then(([idleGltf, runGltf, repairGltf, yellGltf]) => {
      const idleClip = idleGltf.animations[0];
      const walkClip = runGltf.animations[0];
      const repairClip = repairGltf.animations[0];
      const yellClip = yellGltf.animations[0];
      idleClip.name = 'idle';
      walkClip.name = 'walk';
      repairClip.name = 'repair';
      yellClip.name = 'yell';

      console.log('clip durations — idle:', idleClip.duration, 'walk:', walkClip.duration, 'repair:', repairClip.duration, 'yell:', yellClip.duration);

      idleClip.uuid = MathUtils.generateUUID();
      walkClip.uuid = MathUtils.generateUUID();
      repairClip.uuid = MathUtils.generateUUID();
      yellClip.uuid = MathUtils.generateUUID();

      stripRootMotion(walkClip);
      stripRootMotion(repairClip);
      stripRootMotion(yellClip);

      return { scene: idleGltf.scene, animations: [idleClip, walkClip, repairClip, yellClip] };
    });
  }
  return pending;
}
