import * as THREE from 'three';
import settings from '../config/settings.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { attachToHand, buildActionMap, crossfadeTo, groundModel, lerpAngle, tintMesh, updateMixer } from './characterAnim.js';
import { cloneStorageModel } from './StorageModels.js';
import { getProductImage } from './productImages.js';

const HEAD_LABEL_Y = 2.1; // floats just above the head

/**
 * MarketCustomer — one shopper NPC, the same rigged glTF as the player/workers,
 * cloned + tinted with its own customer.tint (core/supermarket.js's spawnCustomer
 * picks one per spawn, never repeating the previous customer's — see
 * settings.character.customerTints — so consecutive customers never look like
 * the same person). Walks in, queues, walks to checkout, walks out (core owns
 * its position/rotation/state; this only renders it). Walks in idle/walkSlow
 * until it collects at checkout, then hauls a Bag.glb (parented to its hand
 * bone) out on the 'carryWalk' clip until it exits and is disposed.
 * Shows its order (qty + product photo per entry, e.g. "2🍎 1🥕") on a
 * head-label sprite for its whole lifetime — the request never changes after
 * spawn, so it's drawn once (redrawn only if a photo finishes loading late).
 */
export class MarketCustomer {
  /** @param {object} customer the customer this view renders (read once, for its tint + order label) */
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

    // Bag.glb carried out once the customer collects at checkout (parented to the
    // hand bone so it tracks the carry animation); hidden until then.
    this.bag = cloneStorageModel('bag');
    this.bag.scale.setScalar(settings.supermarket.bagScale);
    this.bag.visible = false;
    attachToHand(this.model, this.bag, settings.supermarket.bagHandOffset, settings.supermarket.bagHandRotation);

    this.headLabel = makeRequestSprite();
    this.headLabel.position.set(0, HEAD_LABEL_Y, 0); // on the Y axis — unaffected by root's facing rotation
    // Drawn with product photos when they're loaded; letters until then, with a
    // one-shot redraw in update() once every needed photo is ready.
    this.request = customer.request;
    this.labelHasAllImages = drawRequestSprite(this.headLabel, customer.request);
    this.root.add(this.headLabel);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = buildActionMap(this.mixer, gltf.animations, cfg.animationMap);
    this.state = 'idle';
    this.actions.idle?.play(); // starts at full weight; no fade-in from nothing
  }

  /** @param {object} customer one entry of core's state.supermarket.customerQueue */
  update(dt, customer) {
    // The photos usually beat the first spawn, but if this label was drawn with
    // letter fallbacks, swap in the images the frame they finish loading.
    if (!this.labelHasAllImages && Object.keys(this.request).every((t) => getProductImage(t))) {
      this.labelHasAllImages = drawRequestSprite(this.headLabel, this.request);
    }

    this.root.position.x = customer.position.x;
    this.root.position.z = customer.position.z;

    const t = 1 - Math.exp(-settings.player.turnLerp * dt);
    this.root.rotation.y = lerpAngle(this.root.rotation.y, customer.rotation, t);

    // The customer collects its bag at the checkout — core flips it to
    // 'walkingOut' at that moment — and carries it (hand-attached Bag.glb +
    // 'carryWalk') from there until it leaves; before that it walks empty-handed.
    const carrying = customer.state === 'walkingOut';
    const next = carrying ? (customer.moving ? 'carryWalk' : 'carryIdle') : customer.moving ? 'walkSlow' : 'idle';
    this.state = crossfadeTo(this.actions, this.state, next, settings.character.crossfadeDuration);
    this.bag.visible = carrying;

    updateMixer(this.mixer, dt, 'MarketCustomer');
  }

  dispose(sceneManager) {
    // Detach the carried bag first: its geometry is shared with every other
    // Bag.glb clone (worker's bag, checkout bag), so it must NOT be caught by the
    // root geometry-dispose below. Only its own cloned materials are freed.
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
    // The head label's canvas texture is per-instance (see makeRequestSprite)
    // and is NOT freed by its material's dispose — release it explicitly.
    this.headLabel.userData.tex.dispose();
    // Dispose ONLY per-instance materials (tintMesh clones them). The skinned
    // geometry is NOT ours: SkeletonUtils.clone shares it with the base gltf
    // used by the player and every worker NPC, so disposing it here would break
    // them (the shared-resource hazard CarView.dispose documents). The tinted
    // materials' texture maps are shared with the base too — material.dispose()
    // leaves maps alone, which is exactly right.
    this.root.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
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
  sprite.scale.set(3.5, 0.875, 1); // 1.75x the original 2 x 0.5 — sized up for the product photos
  sprite.renderOrder = 999;
  sprite.userData.canvas = canvas;
  sprite.userData.tex = tex;
  return sprite;
}

/**
 * "2🍎 1🥕" — quantity immediately followed by the product's photo, space-
 * separated (the letter itself if that photo hasn't loaded yet). Returns true
 * once every entry rendered with its photo, so the caller can stop redrawing.
 */
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
