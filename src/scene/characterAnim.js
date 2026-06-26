import * as THREE from 'three';

/**
 * characterAnim.js — shared AnimationAction setup + crossfade for any rigged
 * character (player or worker), all driven off the same settings.character
 * animationMap so the logic isn't duplicated between Character and Mechanic.
 */

/**
 * One AnimationAction per mapped state, built from the same mixer + clip list.
 * If a mapped name isn't found (e.g. a Mixamo export named "mixamo.com"
 * instead of "Walk"), falls back to the model's first clip and warns, so the
 * character always has something to play instead of silently freezing.
 */
export function buildActionMap(mixer, clips, animationMap) {
  const actions = {};
  const fallbackClip = clips[0];

  for (const [state, clipName] of Object.entries(animationMap)) {
    let clip = clips.find((c) => c.name === clipName);
    if (!clip && fallbackClip) {
      console.warn(
        `[characterAnim] no clip named "${clipName}" for state "${state}" — falling back to "${fallbackClip.name}". Check settings.character.animationMap.`
      );
      clip = fallbackClip;
    }
    if (!clip) {
      console.warn(`[characterAnim] no clip named "${clipName}" for state "${state}", and the model has no clips at all.`);
      continue;
    }
    actions[state] = mixer.clipAction(clip);
  }
  return actions;
}

/** Standard three.js crossfade: fade the old action out, the new one in. No-ops if the state is already active or unmapped. */
export function crossfadeTo(actions, current, next, duration) {
  if (current === next) return next;
  const to = actions[next];
  if (!to) return current; // animationMap points at a clip that doesn't exist — stay put
  const from = current ? actions[current] : null;
  to.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(duration).play();
  if (from && from !== to) from.fadeOut(duration);
  return next;
}

/**
 * Shifts a model up/down so the bottom of its bounding box sits exactly at
 * y=0 — corrects a mesh whose origin isn't at floor level (a common Mixamo
 * export quirk). Call once, right after the model is added under its root.
 */
export function groundModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;
}

/** mixer.update(dt), with a warning if dt is ever missing/zero (a sign the caller isn't passing a real frame delta). */
export function updateMixer(mixer, dt, label) {
  if (!dt) {
    console.warn(`[characterAnim] ${label}: mixer.update called with dt=${dt}`);
  }
  mixer.update(dt);
}

const _attachPos = new THREE.Vector3();
const _attachQuat = new THREE.Quaternion();
const _attachScale = new THREE.Vector3();

/**
 * Parents a prop (e.g. a carried Bag.glb / box clone) under the character's hand
 * bone so it tracks the hand through every animation frame. The rigged glTF's
 * hand bones import as 'handr'/'handl' (Rigify 'hand.r'/'hand.l', with the dots
 * stripped by GLTFLoader's node-name sanitiser — the same reason stripRootMotion
 * targets 'rootx'/'root'). Prefers the right hand, falls back to the left, and
 * finally to the model root with a warning so a prop is never silently lost.
 *
 * The rig bakes a 0.01 (cm→m) scale into its root bone, so a hand bone's WORLD
 * scale is 0.01 — a prop parented straight onto it would render at 1/100th size
 * and look invisible. We divide that world scale back out so the local scale the
 * caller already set (e.g. settings.supermarket.bagScale) becomes the prop's
 * effective WORLD size.
 *
 * `offset` ({x,y,z}) and `rotation` ({x,y,z} Euler radians) place the prop in the
 * hand bone's local space (a prop's natural pivot rarely sits where the palm is).
 * Both default to no transform. Returns the parent it attached to.
 */
export function attachToHand(model, prop, offset, rotation) {
  const hand = model.getObjectByName('handr') || model.getObjectByName('handl');
  const parent = hand ?? model;
  if (!hand) {
    console.warn('[characterAnim] no hand bone (handr/handl) found — attaching prop to the model root instead.');
  }
  parent.add(prop);
  parent.updateWorldMatrix(true, false);
  parent.matrixWorld.decompose(_attachPos, _attachQuat, _attachScale);
  if (_attachScale.x && _attachScale.y && _attachScale.z) {
    prop.scale.set(prop.scale.x / _attachScale.x, prop.scale.y / _attachScale.y, prop.scale.z / _attachScale.z);
  }
  if (offset) prop.position.set(offset.x, offset.y, offset.z);
  if (rotation) prop.rotation.set(rotation.x, rotation.y, rotation.z);
  return parent;
}

/** Shortest-path angle interpolation (handles wrap-around), used by every moving character. */
export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Clones a mesh's material(s) — so a tinted clone never mutates the shared
 * source materials — and recolors them. Materials without a `.color` (some
 * custom shaders) are left as-is. Used to make worker/cashier clones read as
 * distinct from the player (settings.character.workerTint / cashierTint).
 */
export function tintMesh(mesh, color) {
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
