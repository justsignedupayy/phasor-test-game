import * as THREE from 'three';

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

export function crossfadeTo(actions, current, next, duration) {
  if (current === next) return next;
  const to = actions[next];
  if (!to) return current; // animationMap points at a clip that doesn't exist — stay put
  const from = current ? actions[current] : null;
  to.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(duration).play();
  if (from && from !== to) from.fadeOut(duration);
  return next;
}

export function groundModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;
}

export function buildTapHitBox(radius, height) {
  const hitBox = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 8), new THREE.MeshBasicMaterial());
  hitBox.visible = false;
  hitBox.position.y = height / 2;
  return hitBox;
}

export function updateMixer(mixer, dt, label) {
  if (!dt) {
    console.warn(`[characterAnim] ${label}: mixer.update called with dt=${dt}`);
  }
  mixer.update(dt);
}

const _attachPos = new THREE.Vector3();
const _attachQuat = new THREE.Quaternion();
const _attachScale = new THREE.Vector3();

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
    prop.position.set(
      hasScale ? offset.x / _attachScale.x : offset.x,
      hasScale ? offset.y / _attachScale.y : offset.y,
      hasScale ? offset.z / _attachScale.z : offset.z
    );
  }
  if (rotation) prop.rotation.set(rotation.x, rotation.y, rotation.z);
  return parent;
}

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

export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

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
