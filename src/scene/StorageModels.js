import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import settings from '../config/settings.js';
import { assetUrl } from '../platform/assetUrl.js';

const models = new Map(); // key -> THREE.Object3D base scene to clone
let promise = null;

export function preloadStorageModels() {
  if (!promise) {
    const loader = new GLTFLoader();
    const entries = Object.entries(settings.models); // [key, filename]
    promise = Promise.all(
      entries.map(([key, file]) =>
        loader.loadAsync(assetUrl(encodeURI(`models/${file}`))).then(
          (gltf) => {
            models.set(key, gltf.scene);
          },
          () => {
            console.warn(`StorageModels: could not load "${file}" — using a placeholder box`);
            models.set(key, placeholderBox());
          }
        )
      )
    );
  }
  return promise;
}

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

function getStorageModel(key) {
  const base = models.get(key);
  if (!base) {
    throw new Error(`getStorageModel: "${key}" not loaded — call preloadStorageModels() first`);
  }
  return base;
}

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
