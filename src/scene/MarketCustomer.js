import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { attachToHand, buildActionMap, crossfadeTo, groundModel, lerpAngle, tintMesh, updateMixer } from './characterAnim.js';
import { cloneStorageModel } from './StorageModels.js';
import { getProductImage } from './productImages.js';

const HEAD_LABEL_Y = 2.1; // floats just above the head

export class MarketCustomer {
  constructor(gltf, customer) {
    const cfg = settings.character;

    this.root = new THREE.Group();

    this.model = clone(gltf.scene);
    this.model.scale.setScalar(cfg.modelScale);
    this.model.rotation.y = cfg.modelYRotationOffset;
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        tintMesh(o, customer.tint);
      }
    });
    this.root.add(this.model);
    groundModel(this.model); // the model's mesh origin isn't at floor level — sit it on y=0

    this.bag = cloneStorageModel('bag');
    this.bag.scale.setScalar(settings.supermarket.bagScale);
    this.bag.visible = false;
    attachToHand(this.model, this.bag, settings.supermarket.bagHandOffset, settings.supermarket.bagHandRotation);

    this.headLabel = makeRequestSprite();
    this.headLabel.position.set(0, HEAD_LABEL_Y, 0); // on the Y axis — unaffected by root's facing rotation
    this.request = customer.request;
    this.labelHasAllImages = drawRequestSprite(this.headLabel, customer.request);
    this.root.add(this.headLabel);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = buildActionMap(this.mixer, gltf.animations, cfg.animationMap);
    this.state = 'idle';
    this.actions.idle?.play(); // starts at full weight; no fade-in from nothing
  }

  update(dt, customer) {
    if (!this.labelHasAllImages && Object.keys(this.request).every((t) => getProductImage(t))) {
      this.labelHasAllImages = drawRequestSprite(this.headLabel, this.request);
    }

    this.root.position.x = customer.position.x;
    this.root.position.z = customer.position.z;

    const t = 1 - Math.exp(-settings.player.turnLerp * dt);
    this.root.rotation.y = lerpAngle(this.root.rotation.y, customer.rotation, t);

    const carrying = customer.state === 'walkingOut';
    const next = carrying ? (customer.moving ? 'carryWalk' : 'carryIdle') : customer.moving ? 'walkSlow' : 'idle';
    this.state = crossfadeTo(this.actions, this.state, next, settings.character.crossfadeDuration);
    this.bag.visible = carrying;

    updateMixer(this.mixer, dt, 'MarketCustomer');
  }

  dispose(sceneManager) {
    if (this.bag) {
      this.bag.removeFromParent();
      this.bag.traverse((o) => {
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
      this.bag = null;
    }

    sceneManager.remove(this.root);
    this.headLabel.userData.tex.dispose();
    this.root.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}

function makeRequestSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
  );
  sprite.scale.set(3.5, 0.875, 1); // 1.75x the original 2 x 0.5 — sized up for the product photos
  sprite.renderOrder = 999;
  sprite.userData.canvas = canvas;
  sprite.userData.tex = tex;
  return sprite;
}

function drawRequestSprite(sprite, request) {
  const canvas = sprite.userData.canvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = settings.colors.label;
  ctx.font = `800 30px ${settings.ui.fontStack}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;

  const IMG = 48; // square photo edge, inside the 64px-high canvas
  const GAP = 2; // qty-to-photo
  const SPACE = 14; // between entries
  let allImages = true;
  const parts = Object.entries(request).map(([type, qty]) => {
    const img = getProductImage(type);
    if (!img) allImages = false;
    const qtyWidth = ctx.measureText(`${qty}`).width;
    return { qty: `${qty}`, type, img, qtyWidth, width: qtyWidth + GAP + (img ? IMG : ctx.measureText(type).width) };
  });
  const total = parts.reduce((sum, p) => sum + p.width, 0) + SPACE * (parts.length - 1);

  let x = (canvas.width - total) / 2;
  const midY = canvas.height / 2;
  for (const p of parts) {
    ctx.fillText(p.qty, x, midY + 2);
    x += p.qtyWidth + GAP;
    if (p.img) ctx.drawImage(p.img, x, midY - IMG / 2, IMG, IMG);
    else ctx.fillText(p.type, x, midY + 2);
    x += p.width - p.qtyWidth - GAP + SPACE;
  }
  sprite.userData.tex.needsUpdate = true;
  return allImages;
}
