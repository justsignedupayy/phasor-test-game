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

/**
 * Builds an invisible cylinder for tap raycasting (yell / resting-worker taps),
 * meant to be added to a worker's root and used INSTEAD of the rigged body mesh —
 * the mesh is thin and mid-animation limbs move around, so raycasting it directly
 * is too easy to miss on a touchscreen; a generous fixed hit target fixes that.
 * Three.js raycasting ignores `.visible`, so this stays invisible but still hits.
 */
export function buildTapHitBox(radius, height) {
  const hitBox = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 8), new THREE.MeshBasicMaterial());
  hitBox.visible = false;
  hitBox.position.y = height / 2;
  return hitBox;
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
 * `offset` ({x,y,z}) and `rotation` ({x,y,z} Euler radians) place the prop relative
 * to the hand bone (a prop's natural pivot rarely sits where the palm is). The
 * offset is given in WORLD units, like the (scale-compensated) prop size: because
 * the prop sits in the hand bone's local space — whose world scale is the rig's
 * baked 0.01 — a raw local offset would be shrunk 100×, so we divide the offset by
 * that same world scale (the inverse of how the prop's own scale is compensated
 * above). Rotation is scale-invariant, so it's applied as-is. Both default to no
 * transform.
 *
 * `preferred` ('r' | 'l', default 'r') picks which hand bone to try first — e.g.
 * the wrench uses 'l' so it doesn't collide with a box/bag already on the right
 * hand. Falls back to the other hand, then the model root. Returns the parent
 * it attached to.
 */
export function attachToHand(model, prop, offset, rotation, preferred = 'r') {
  const first = preferred === 'l' ? 'handl' : 'handr';
  const second = preferred === 'l' ? 'handr' : 'handl';
  const hand = model.getObjectByName(first) || model.getObjectByName(second);
  const parent = hand ?? model;
  if (!hand) {
    console.warn('[characterAnim] no hand bone (handr/handl) found — attaching prop to the model root instead.');
  }
  parent.add(prop);
  parent.updateWorldMatrix(true, false);
  parent.matrixWorld.decompose(_attachPos, _attachQuat, _attachScale);
  const hasScale = _attachScale.x && _attachScale.y && _attachScale.z;
  if (hasScale) {
    prop.scale.set(prop.scale.x / _attachScale.x, prop.scale.y / _attachScale.y, prop.scale.z / _attachScale.z);
  }
  if (offset) {
    // Divide the world-unit offset by the bone's world scale so it lands at the
    // intended world distance (matches the scale compensation done for the prop).
    prop.position.set(
      hasScale ? offset.x / _attachScale.x : offset.x,
      hasScale ? offset.y / _attachScale.y : offset.y,
      hasScale ? offset.z / _attachScale.z : offset.z
    );
  }
  if (rotation) prop.rotation.set(rotation.x, rotation.y, rotation.z);
  return parent;
}

/**
 * A lean offset ({ side, forward, lift }) resolved into a world-space delta for
 * a facing `facing` (radians; 0 faces +z, matching the game's atan2(dx,dz)
 * convention). `forward` runs along the facing, `side` across it, `lift` straight
 * up. Shared by Mechanic.js / MarketWorker.js so a worker on break leans upright
 * against the wall at its break spot (see settings.breaks.leanOffset).
 */
export function leanOffsetDelta(facing, offset) {
  const fwdX = Math.sin(facing);
  const fwdZ = Math.cos(facing);
  const sideX = Math.cos(facing);
  const sideZ = -Math.sin(facing);
  return {
    x: offset.side * sideX + offset.forward * fwdX,
    y: offset.lift,
    z: offset.side * sideZ + offset.forward * fwdZ,
  };
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
