import * as THREE from 'three';
import settings from '../config/settings.js';
import { laneBridgeElevationAt } from '../core/roads.js';
import { buildActionMap, crossfadeTo, groundModel, lerpAngle, updateMixer } from './characterAnim.js';

/**
 * Character — the player, rendered as the shared rigged glTF model (see
 * CharacterModel.js). Render-only: reads the core player state each frame and
 * drives position/facing plus an AnimationMixer crossfading between
 * idle/walk/repair/yell clips. No skeletal logic of its own — it just owns one
 * mixer + action set built from the model's own clips.
 *
 * Built so this.root's position/rotation API matches the old primitive
 * version exactly (main.js doesn't change how it drives this class).
 */
const EMOTE_TIME = 0.5; // brief blip for yell/repair before returning to idle/walk

export class Character {
  constructor(gltf) {
    const cfg = settings.character;

    this.root = new THREE.Group(); // x/z position + facing
    this.model = gltf.scene;
    this.model.scale.setScalar(cfg.modelScale);
    this.model.rotation.y = cfg.modelYRotationOffset;
    this.model.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    this.root.add(this.model);
    groundModel(this.model); // the model's mesh origin isn't at floor level — sit it on y=0

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = buildActionMap(this.mixer, gltf.animations, cfg.animationMap);
    this.state = 'idle';
    this.actions.idle?.play(); // starts at full weight; no fade-in from nothing

    this.emoteTimer = 0; // counts down a yell/repair/gaspump blip
    this.emoteState = null; // 'yell' | 'repair' | 'gaspump' while the blip is active
  }

  /** Quick yell emote (used by the remote hurry tap). */
  yell() {
    this.#emote('yell');
  }

  /** Quick repair emote (used by the manual pit repair tap). */
  repair() {
    this.#emote('repair');
  }

  /** Quick gas-fill emote (the manual pump fill tap) — the same 'gaspump'
   * clip the attendants play, instead of the pit repair animation. */
  pumpGas() {
    this.#emote('gaspump');
  }

  #emote(clip) {
    this.emoteState = clip;
    this.emoteTimer = EMOTE_TIME;
  }

  update(dt, player, state) {
    // Position from core state. Core positions stay 2D — the y is the pit-lane
    // bridge deck height while crossing one (visual only), 0 on the ground.
    this.root.position.x = player.position.x;
    this.root.position.z = player.position.z;
    this.root.position.y = laneBridgeElevationAt(state, player.position.x, player.position.z);

    // Smoothly turn toward the target facing (frame-rate independent).
    const t = 1 - Math.exp(-settings.player.turnLerp * dt);
    this.root.rotation.y = lerpAngle(this.root.rotation.y, player.rotation, t);

    // Active state: a yell/repair blip wins briefly, else carrying a box —
    // either a pit tire box (carryingBox) or a market restock box
    // (carryingRestockBox) — overrides walk/idle with carry/carryIdle.
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

    updateMixer(this.mixer, dt, 'Character');
  }
}
