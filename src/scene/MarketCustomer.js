import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildActionMap, crossfadeTo, groundModel, lerpAngle, tintMesh, updateMixer } from './characterAnim.js';

const HEAD_LABEL_Y = 2.1; // floats just above the head

/**
 * MarketCustomer — one shopper NPC, the same rigged glTF as the player/workers,
 * cloned + tinted (customerTint). Walks in, queues, walks to checkout, walks
 * out (core/supermarket.js owns its position/rotation/state; this only
 * renders it). Idle/walkSlow only — no carry, since a customer doesn't
 * visibly hold its bag until after checkout, which is also when it leaves.
 * Shows its order (e.g. "2A 1C") on a head-label sprite for its whole
 * lifetime — the request never changes after spawn, so it's drawn once.
 */
export class MarketCustomer {
  /** @param {object} customer the customer this view renders (read once, for its order label) */
  constructor(gltf, customer) {
    const cfg = settings.character;

    this.root = new THREE.Group();

    this.model = clone(gltf.scene);
    this.model.scale.setScalar(cfg.modelScale);
    this.model.rotation.y = cfg.modelYRotationOffset;
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        tintMesh(o, cfg.customerTint);
      }
    });
    this.root.add(this.model);
    groundModel(this.model); // the model's mesh origin isn't at floor level — sit it on y=0

    this.headLabel = makeRequestSprite();
    this.headLabel.position.set(0, HEAD_LABEL_Y, 0); // on the Y axis — unaffected by root's facing rotation
    drawRequestSprite(this.headLabel, formatRequest(customer.request));
    this.root.add(this.headLabel);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = buildActionMap(this.mixer, gltf.animations, cfg.animationMap);
    this.state = 'idle';
    this.actions.idle?.play(); // starts at full weight; no fade-in from nothing
  }

  /** @param {object} customer one entry of core's state.supermarket.customerQueue */
  update(dt, customer) {
    this.root.position.x = customer.position.x;
    this.root.position.z = customer.position.z;

    const t = 1 - Math.exp(-settings.player.turnLerp * dt);
    this.root.rotation.y = lerpAngle(this.root.rotation.y, customer.rotation, t);

    const next = customer.moving ? 'walkSlow' : 'idle';
    this.state = crossfadeTo(this.actions, this.state, next, settings.character.crossfadeDuration);

    updateMixer(this.mixer, dt, 'MarketCustomer');
  }

  dispose(sceneManager) {
    sceneManager.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}

/** "2A 1C" — quantity immediately followed by the product letter, space-separated. */
function formatRequest(request) {
  return Object.entries(request)
    .map(([type, qty]) => `${qty}${type}`)
    .join(' ');
}

// A small camera-facing text label (mirrors PitView's/SupermarketView's canvas-sprite labels).
function makeRequestSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  // depthTest: false + a high renderOrder — this is a floating nameplate-style
  // label on a character that moves every frame; relying on the depth buffer
  // here intermittently occluded it against the floor/model, so it always
  // draws on top instead, like the rest of this game's screen-space labels.
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
  );
  sprite.scale.set(2, 0.5, 1);
  sprite.renderOrder = 999;
  sprite.userData.canvas = canvas;
  sprite.userData.tex = tex;
  return sprite;
}

function drawRequestSprite(sprite, text) {
  const canvas = sprite.userData.canvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = settings.colors.label;
  ctx.font = '800 30px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  sprite.userData.tex.needsUpdate = true;
}
