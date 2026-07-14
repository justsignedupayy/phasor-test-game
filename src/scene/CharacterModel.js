import { MathUtils } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetUrl } from '../platform/assetUrl.js';

let pending = null;

function stripRootMotion(clip) {
  clip.tracks = clip.tracks.filter((track) => track.name !== 'rootx.position' && track.name !== 'root.position');
}

export function loadCharacterModel() {
  if (!pending) {
    const loader = new GLTFLoader();
    pending = Promise.all([
      loader.loadAsync(assetUrl('models/character_idle.glb')),
      loader.loadAsync(assetUrl('models/character_run.glb')),
      loader.loadAsync(assetUrl('models/character_repair.glb')),
      loader.loadAsync(assetUrl('models/character_yell.glb')),
      loader.loadAsync(assetUrl('models/character_carry_run.glb')),
      loader.loadAsync(assetUrl('models/character_carry_idle.glb')),
      loader.loadAsync(assetUrl('models/character_sassy_walk.glb')),
      loader.loadAsync(assetUrl('models/character_carry_walk.glb')),
      loader.loadAsync(assetUrl('models/character_sitting.glb')),
      loader.loadAsync(assetUrl('models/gasput.glb')),
      loader.loadAsync(assetUrl('models/character_resting.glb')),
    ]).then(([idleGltf, runGltf, repairGltf, yellGltf, carryGltf, carryIdleGltf, walkGltf, carryWalkGltf, sittingGltf, gasPumpGltf, restingGltf]) => {
      const idleClip = idleGltf.animations[0];
      const walkClip = runGltf.animations[0];
      const repairClip = repairGltf.animations[0];
      const yellClip = yellGltf.animations[0];
      const carryClip = carryGltf.animations[0];
      const carryIdleClip = carryIdleGltf.animations[0];
      const walkSlowClip = walkGltf.animations[0];
      const carryWalkClip = carryWalkGltf.animations[0];
      const sittingClip = sittingGltf.animations[0];
      const gasPumpClip = gasPumpGltf.animations[0];
      const restingClip = restingGltf.animations[0];
      idleClip.name = 'idle';
      walkClip.name = 'walk';
      repairClip.name = 'repair';
      yellClip.name = 'yell';
      carryClip.name = 'carry';
      carryIdleClip.name = 'carryIdle';
      walkSlowClip.name = 'walkSlow';
      carryWalkClip.name = 'carryWalk';
      sittingClip.name = 'sitting';
      gasPumpClip.name = 'gaspump';
      restingClip.name = 'resting';

      idleClip.uuid = MathUtils.generateUUID();
      walkClip.uuid = MathUtils.generateUUID();
      repairClip.uuid = MathUtils.generateUUID();
      yellClip.uuid = MathUtils.generateUUID();
      carryClip.uuid = MathUtils.generateUUID();
      carryIdleClip.uuid = MathUtils.generateUUID();
      walkSlowClip.uuid = MathUtils.generateUUID();
      carryWalkClip.uuid = MathUtils.generateUUID();
      sittingClip.uuid = MathUtils.generateUUID();
      gasPumpClip.uuid = MathUtils.generateUUID();
      restingClip.uuid = MathUtils.generateUUID();

      stripRootMotion(walkClip);
      stripRootMotion(repairClip);
      stripRootMotion(yellClip);
      stripRootMotion(carryClip);
      stripRootMotion(walkSlowClip);
      stripRootMotion(carryWalkClip);
      stripRootMotion(sittingClip);
      stripRootMotion(gasPumpClip); // in-place action at the pump, like repair
      stripRootMotion(restingClip);

      return {
        scene: idleGltf.scene,
        animations: [
          idleClip,
          walkClip,
          repairClip,
          yellClip,
          carryClip,
          carryIdleClip,
          walkSlowClip,
          carryWalkClip,
          sittingClip,
          gasPumpClip,
          restingClip,
        ],
      };
    });
  }
  return pending;
}
