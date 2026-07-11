import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import settings from '../config/settings.js';

/**
 * StorageModels — loads the static storage-system glbs (shelf, box, tires, …)
 * exactly once at startup, same one-load-then-clone pattern as
 * preloadCarModels(). Keyed by the logical name from settings.models. Call (and
 * await) preloadStorageModels() before constructing any PitView / CarriedBox,
 * then clone per instance via cloneStorageModel(key).
 */
const models = new Map(); // key -> THREE.Object3D base scene to clone
let promise = null;

export function preloadStorageModels() {
  if (!promise) {
    const loader = new GLTFLoader();
    const entries = Object.entries(settings.models); // [key, filename]
    promise = Promise.all(
      entries.map(([key, file]) =>
        // encodeURI guards any future filename with spaces/odd chars.
        loader.loadAsync(encodeURI(`/models/${file}`)).then(
          (gltf) => {
            models.set(key, gltf.scene);
          },
          () => {
            // A missing/broken glb must never brick the boot (mirrors the
            // animationMap fallback philosophy): warn and stand in a plain box.
            console.warn(`StorageModels: could not load "${file}" — using a placeholder box`);
            models.set(key, placeholderBox());
          }
        )
      )
    );
  }
  return promise;
}

/** Stand-in scene for a glb that failed to load: a small neutral box. */
function placeholderBox() {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1.6, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x9a9a9a, flatShading: true })
    )
  );
  group.children[0].position.y = 0.8; // sit on the floor
  return group;
}

/** The preloaded base scene for a key (settings.models.*); clone it per instance. */
function getStorageModel(key) {
  const base = models.get(key);
  if (!base) {
    throw new Error(`getStorageModel: "${key}" not loaded — call preloadStorageModels() first`);
  }
  return base;
}

/**
 * Shared clone helper: deep-clones a preloaded base scene, enables shadows, and
 * clones every material so a later dispose() never frees geometry/materials that
 * other clones still share (same hazard CarView guards against).
 */
export function cloneStorageModel(key) {
  const clone = getStorageModel(key).clone(true);
  clone.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (!o.material) return;
    const arr = Array.isArray(o.material);
    const mats = (arr ? o.material : [o.material]).map((m) => m.clone());
    o.material = arr ? mats : mats[0];
  });
  return clone;
}
