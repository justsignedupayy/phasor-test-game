import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import settings from '../config/settings.js';
import { laneBridgeElevationAt } from '../core/roads.js';
import { attachToHand, buildActionMap, crossfadeTo, groundModel, lerpAngle, updateMixer } from './characterAnim.js';
import { cloneStorageModel } from './StorageModels.js';

const EMOTE_TIME = 0.5; // brief blip for yell/repair before returning to idle/walk

const HIGHLIGHT_ORDER = 1;
const PLAYER_ORDER = 2;

const ANGER_FILL = '#000000';
const ANGER_STROKE = '#000000';
const ANGER_BG = '#fff8f5';
const ANGER_POP_IN = 0.15; // seconds: scale 0.5 -> 1.2
const ANGER_SETTLE = 0.15; // seconds: scale 1.2 -> 1, jitter settling
const ANGER_HOLD = 0.3; // seconds held at rest before fading
const ANGER_FADE = 0.2; // seconds to fade out
const ANGER_TOTAL = ANGER_POP_IN + ANGER_SETTLE + ANGER_HOLD + ANGER_FADE;
const ANGER_JITTER = 0.09; // local-space horizontal jitter amplitude, decaying to 0

let angerTexture = null;

function getAngerTexture() {
  if (angerTexture) return angerTexture;
  const w = 160, h = 112;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = ANGER_BG;
  ctx.strokeStyle = ANGER_STROKE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(66, 70);
  ctx.lineTo(94, 70);
  ctx.lineTo(78, 106);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const r = 20, bx = 6, by = 6, bw = w - 12, bh = 66;
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
  ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
  ctx.arcTo(bx, by + bh, bx, by, r);
  ctx.arcTo(bx, by, bx + bw, by, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = ANGER_FILL;
  ctx.font = `800 34px ${settings.ui.fontStack}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?!@&#!', w / 2, by + bh / 2 + 2);

  angerTexture = new THREE.CanvasTexture(canvas);
  return angerTexture;
}

export class Character {
  constructor(gltf) {
    const cfg = settings.character;

    this.root = new THREE.Group(); // x/z position + facing
    this.model = clone(gltf.scene);
    this.model.scale.setScalar(cfg.modelScale);
    this.model.rotation.y = cfg.modelYRotationOffset;
    this.model.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    this.root.add(this.model);
    groundModel(this.model); // the model's mesh origin isn't at floor level — sit it on y=0

    this.#buildOcclusionHighlight();

    this.wrench = cloneStorageModel('wrench');
    this.wrench.scale.setScalar(cfg.wrenchOffset.scale);
    this.wrench.visible = false;
    attachToHand(this.model, this.wrench, cfg.wrenchOffset.offset, cfg.wrenchOffset.rotation, 'l');
    this.wrench.traverse((o) => {
      if (o.isMesh) o.renderOrder = PLAYER_ORDER;
    });

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = buildActionMap(this.mixer, gltf.animations, cfg.animationMap);
    this.state = 'idle';
    this.actions.idle?.play(); // starts at full weight; no fade-in from nothing

    this.emoteTimer = 0; // counts down a yell/repair/gaspump blip
    this.emoteState = null; // 'yell' | 'repair' | 'gaspump' while the blip is active

    this.angerBubble = null; // active one-shot AngerBubble sprite + its own timer, or null
  }

  #buildOcclusionHighlight() {
    const ghostMat = new THREE.MeshBasicMaterial({
      color: settings.character.occlusionHighlight.color,
      depthTest: true,
      depthFunc: THREE.GreaterDepth, // pass only where this fragment is behind the buffer
      depthWrite: false,
      fog: false,
      toneMapped: false, // keep the neon colour pure, never dimmed by tone mapping
    });

    const meshes = [];
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.renderOrder = PLAYER_ORDER; // the normal player draws AFTER its ghost
        meshes.push(o);
      }
    });

    for (const o of meshes) {
      const ghost = o.isSkinnedMesh
        ? new THREE.SkinnedMesh(o.geometry, ghostMat)
        : new THREE.Mesh(o.geometry, ghostMat);
      if (o.isSkinnedMesh) {
        ghost.bind(o.skeleton, o.bindMatrix); // share the live skeleton → deforms identically
        ghost.bindMode = o.bindMode;
      }
      ghost.renderOrder = HIGHLIGHT_ORDER;
      ghost.castShadow = false;
      ghost.receiveShadow = false;
      ghost.frustumCulled = false; // never cull the silhouette independently of its source
      o.add(ghost); // child at identity local transform → shares the source mesh's world matrix
    }
  }

  showAngerBubble() {
    if (this.angerBubble) {
      this.root.remove(this.angerBubble.sprite);
      this.angerBubble.sprite.material.dispose();
    }
    const cfg = settings.character;
    const material = new THREE.SpriteMaterial({ map: getAngerTexture(), transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    const scale = settings.emote.spriteScale;
    sprite.scale.set(scale * 1.4, scale, 1); // texture is wider than tall
    sprite.position.set(0, cfg.headHeight + settings.emote.heightAboveHead, 0);
    this.root.add(sprite);
    this.angerBubble = { sprite, t: 0 };
  }

  #updateAngerBubble(dt) {
    const bubble = this.angerBubble;
    if (!bubble) return;
    bubble.t += dt;
    const { sprite, t } = bubble;
    const scale = settings.emote.spriteScale;

    let s, jitter, opacity = 1;
    if (t < ANGER_POP_IN) {
      const p = t / ANGER_POP_IN;
      s = 0.5 + p * 0.7; // 0.5 -> 1.2
      jitter = p * ANGER_JITTER;
    } else if (t < ANGER_POP_IN + ANGER_SETTLE) {
      const p = (t - ANGER_POP_IN) / ANGER_SETTLE;
      s = 1.2 - p * 0.2; // 1.2 -> 1
      jitter = ANGER_JITTER * (1 - p) * Math.cos(p * Math.PI * 2.5);
    } else if (t < ANGER_POP_IN + ANGER_SETTLE + ANGER_HOLD) {
      s = 1;
      jitter = 0;
    } else {
      const p = Math.min(1, (t - ANGER_POP_IN - ANGER_SETTLE - ANGER_HOLD) / ANGER_FADE);
      s = 1;
      jitter = 0;
      opacity = 1 - p;
    }

    sprite.scale.set(scale * 1.4 * s, scale * s, 1);
    sprite.position.x = jitter;
    sprite.material.opacity = opacity;

    if (t >= ANGER_TOTAL) {
      this.root.remove(sprite);
      sprite.material.dispose();
      this.angerBubble = null;
    }
  }

  yell() {
    this.#emote('yell');
  }

  repair() {
    this.#emote('repair');
  }

  pumpGas() {
    this.#emote('gaspump');
  }

  #emote(clip) {
    this.emoteState = clip;
    this.emoteTimer = EMOTE_TIME;
  }

  update(dt, player, state) {
    this.root.position.x = player.position.x;
    this.root.position.z = player.position.z;
    this.root.position.y = laneBridgeElevationAt(state, player.position.x, player.position.z);

    const t = 1 - Math.exp(-settings.player.turnLerp * dt);
    this.root.rotation.y = lerpAngle(this.root.rotation.y, player.rotation, t);

    let next;
    if (this.emoteTimer > 0) {
      this.emoteTimer = Math.max(0, this.emoteTimer - dt);
      next = this.emoteState;
    } else if (player.carryingBox || player.carryingRestockBox) {
      next = player.moving ? 'carry' : 'carryIdle';
    } else {
      next = player.moving ? 'walk' : 'idle';
    }
    this.state = crossfadeTo(this.actions, this.state, next, settings.character.crossfadeDuration);
    this.wrench.visible = this.state === 'repair';

    this.#updateAngerBubble(dt);
    updateMixer(this.mixer, dt, 'Character');
  }
}
