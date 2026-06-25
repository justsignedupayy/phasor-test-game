import { MathUtils } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * CharacterModel.js — the rigged character is split across seven Mixamo
 * exports, one animation each: character_idle.glb (mesh + skeleton + idle
 * clip), character_run.glb (run clip), character_repair.glb (repair clip),
 * character_yell.glb (yell clip), character_carry_run.glb (carry-while-walking
 * clip), character_carry_idle.glb (carry-while-standing clip), and
 * character_walk.glb (a genuine walking-pace clip), all sharing the same
 * skeleton. They load exactly once and are merged into a single gltf-shaped
 * { scene, animations } result — idle's scene as the base, clips renamed to
 * 'idle'/'walk'/'repair'/'yell'/'carry'/'carryIdle'/'walkSlow' — so the
 * player and every worker/customer clone share one fetched/parsed asset (see
 * Character.js + Mechanic.js + MarketWorker.js + MarketCustomer.js, which
 * build their own AnimationMixer off gltf.scene/animations).
 *
 * Note: 'walk' is actually sourced from the RUN clip — that's the pace the
 * player/mechanic/cashier move at, so it stays as-is. 'walkSlow' (from the
 * newer character_walk.glb) is the genuine walking-pace clip, used by NPCs
 * that move well under run speed (market customers/worker) so their legs
 * don't look like they're sprinting in place — see settings.character.animationMap.
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
      loader.loadAsync('/models/character_carry_run.glb'),
      loader.loadAsync('/models/character_carry_idle.glb'),
      loader.loadAsync('/models/character_walk.glb'),
    ]).then(([idleGltf, runGltf, repairGltf, yellGltf, carryGltf, carryIdleGltf, walkGltf]) => {
      const idleClip = idleGltf.animations[0];
      const walkClip = runGltf.animations[0];
      const repairClip = repairGltf.animations[0];
      const yellClip = yellGltf.animations[0];
      const carryClip = carryGltf.animations[0];
      const carryIdleClip = carryIdleGltf.animations[0];
      const walkSlowClip = walkGltf.animations[0];
      idleClip.name = 'idle';
      walkClip.name = 'walk';
      repairClip.name = 'repair';
      yellClip.name = 'yell';
      carryClip.name = 'carry';
      carryIdleClip.name = 'carryIdle';
      walkSlowClip.name = 'walkSlow';

      console.log(
        'clip durations — idle:', idleClip.duration,
        'walk:', walkClip.duration,
        'repair:', repairClip.duration,
        'yell:', yellClip.duration,
        'carry:', carryClip.duration,
        'carryIdle:', carryIdleClip.duration,
        'walkSlow:', walkSlowClip.duration
      );

      idleClip.uuid = MathUtils.generateUUID();
      walkClip.uuid = MathUtils.generateUUID();
      repairClip.uuid = MathUtils.generateUUID();
      yellClip.uuid = MathUtils.generateUUID();
      carryClip.uuid = MathUtils.generateUUID();
      carryIdleClip.uuid = MathUtils.generateUUID();
      walkSlowClip.uuid = MathUtils.generateUUID();

      // carryIdle is a standing pose (like idle), not a travel cycle, so it
      // keeps its root motion — only the walk-style clips get stripped.
      stripRootMotion(walkClip);
      stripRootMotion(repairClip);
      stripRootMotion(yellClip);
      stripRootMotion(carryClip);
      stripRootMotion(walkSlowClip);

      return {
        scene: idleGltf.scene,
        animations: [idleClip, walkClip, repairClip, yellClip, carryClip, carryIdleClip, walkSlowClip],
      };
    });
  }
  return pending;
}
