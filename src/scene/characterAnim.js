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
