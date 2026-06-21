import * as THREE from 'three';
import settings from '../config/settings.js';
import { buildActionMap, crossfadeTo, groundModel, updateMixer } from './characterAnim.js';

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

    this.emoteTimer = 0; // counts down a yell/repair blip
    this.emoteState = null; // 'yell' | 'repair' while the blip is active
  }

  /** Quick yell emote (used by the remote hurry tap). */
  yell() {
    this.emoteState = 'yell';
    this.emoteTimer = EMOTE_TIME;
  }

  /** Quick repair emote (used by the manual repair tap). */
  repair() {
    this.emoteState = 'repair';
    this.emoteTimer = EMOTE_TIME;
  }

  update(dt, player) {
    // Position from core state.
    this.root.position.x = player.position.x;
    this.root.position.z = player.position.z;

    // Smoothly turn toward the target facing (frame-rate independent).
    const t = 1 - Math.exp(-settings.player.turnLerp * dt);
    this.root.rotation.y = lerpAngle(this.root.rotation.y, player.rotation, t);

    // Active state: a yell/repair blip wins briefly, else moving/idle.
    let next;
    if (this.emoteTimer > 0) {
      this.emoteTimer = Math.max(0, this.emoteTimer - dt);
      next = this.emoteState;
    } else {
      next = player.moving ? 'walk' : 'idle';
    }
    this.state = crossfadeTo(this.actions, this.state, next, settings.character.crossfadeDuration);

    updateMixer(this.mixer, dt, 'Character');
  }
}

// Shortest-path angle interpolation (handles wrap-around).
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
