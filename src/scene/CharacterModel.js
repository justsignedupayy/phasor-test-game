import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * CharacterModel.js — loads /models/character.glb exactly once and caches the
 * promise, so the player and every worker clone share one fetched/parsed
 * asset (see Character.js + Mechanic.js, which build their own AnimationMixer
 * off the shared gltf.scene/gltf.animations).
 */
let pending = null;

export function loadCharacterModel() {
  if (!pending) {
    pending = new GLTFLoader().loadAsync('/models/character.glb').then((gltf) => {
      console.log('clips:', gltf.animations.map((a) => a.name));
      return gltf;
    });
  }
  return pending;
}
