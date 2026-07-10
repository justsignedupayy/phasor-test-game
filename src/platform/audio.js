/**
 * audio.js — every sound effect + music track behind the same swappable-host
 * philosophy as storage.js / ads.js, isolated for the Playgama port.
 *
 * bgmusic loops everywhere, started on load. Three area-ambience layers
 * (garage/gas station/market) loop ON TOP of it simultaneously from load,
 * silently (volume 0) until updateAmbience fades the current zone's track up
 * and the others down each frame — a continuous crossfade with no restart.
 * If the browser's autoplay policy blocks any of these four looping tracks,
 * playback is retried on the first user gesture instead (pointerdown/keydown)
 * — ONE shared listener pair services all of them, so a gesture that arrives
 * before every track has failed still catches the rest.
 *
 * The remaining sounds (walk/hammer/money/bag) are only ever started from a
 * later game action, by which point the page already has a user gesture on
 * record, so they never need the gesture-retry path. Every Audio instance is
 * created once and reused — never recreated per trigger.
 */
import settings from '../config/settings.js';
import { loadMusicVolume, saveMusicVolume } from './storage.js';

const ASSET_DIR = '/assets/audio/';

let music = null;
let ambience = null; // { garage, gasStation, market } Audio instances

let walkSound = null;
let hammerSound = null;
let moneySound = null;
let bagSound = null;

// Autoplay-blocked tracks waiting on the first user gesture, serviced by one
// shared listener pair (see module doc above).
const pendingAutoplay = [];
let gestureListenerBound = false;

function ensureGestureUnlock() {
  if (gestureListenerBound) return;
  gestureListenerBound = true;
  const resume = () => {
    window.removeEventListener('pointerdown', resume);
    window.removeEventListener('keydown', resume);
    for (const audio of pendingAutoplay) audio.play().catch(() => {}); // still blocked somehow — stay silent
    pendingAutoplay.length = 0;
  };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);
}

/** Starts a looping track immediately; on autoplay failure, retries on the shared gesture unlock. */
function startLooping(src, volume) {
  const audio = new Audio(ASSET_DIR + src);
  audio.loop = true;
  audio.volume = volume;
  audio.play().catch(() => {
    pendingAutoplay.push(audio);
    ensureGestureUnlock();
  });
  return audio;
}

export function initMusic() {
  if (music) return; // idempotent — the track is created once
  music = startLooping('bgmusic.mp3', loadMusicVolume());
}

/** Current music volume in [0, 1] (the persisted value until initMusic runs). */
export function getMusicVolume() {
  return music ? music.volume : loadMusicVolume();
}

/** Set music volume in [0, 1]; applies live and persists across sessions. */
export function setMusicVolume(v) {
  const clamped = Math.min(1, Math.max(0, v));
  if (music) music.volume = clamped;
  saveMusicVolume(clamped);
}

/** Starts all three area-ambience layers, silent until updateAmbience fades one in. */
export function initAmbience() {
  if (ambience) return; // idempotent
  ambience = {
    garage: startLooping('garagebg.mp3', 0),
    gasStation: startLooping('gas_stationbg.mp3', 0),
    market: startLooping('marketbg.mp3', 0),
  };
}

/**
 * Call every frame with the player's current zone ('garage' | 'gasStation' |
 * 'market' | null) — each track's volume eases toward its target (the tuned
 * settings.audio.*Volume while it's the current zone, else 0) over
 * settings.audio.ambienceFadeDuration seconds, so crossing a zone boundary
 * fades tracks rather than cutting them.
 */
export function updateAmbience(zone, dt) {
  if (!ambience) return;
  const A = settings.audio;
  const rate = Math.min(1, dt / A.ambienceFadeDuration);
  const targets = {
    garage: zone === 'garage' ? A.garageVolume : 0,
    gasStation: zone === 'gasStation' ? A.gasStationVolume : 0,
    market: zone === 'market' ? A.marketVolume : 0,
  };
  for (const key of Object.keys(targets)) {
    const track = ambience[key];
    track.volume += (targets[key] - track.volume) * rate;
  }
}

/** Loop/pause the player's footstep sound; pause preserves position so resuming never re-triggers from the start. */
export function setWalking(active) {
  if (!walkSound) {
    walkSound = new Audio(ASSET_DIR + 'walk.mp3');
    walkSound.loop = true;
    walkSound.volume = settings.audio.walkVolume;
  }
  if (active) {
    if (walkSound.paused) walkSound.play().catch(() => {});
  } else if (!walkSound.paused) {
    walkSound.pause();
  }
}

/** Loop/stop the repair-hammering sound (player or any pit mechanic actively repairing). */
export function setHammerActive(active) {
  if (!hammerSound) {
    hammerSound = new Audio(ASSET_DIR + 'hammersound.mp3');
    hammerSound.loop = true;
    hammerSound.volume = settings.audio.hammerVolume;
  }
  if (active) {
    if (hammerSound.paused) hammerSound.play().catch(() => {});
  } else if (!hammerSound.paused) {
    hammerSound.pause();
  }
}

/** One-shot: a discrete completed cash gain (pit/pump collect, or an unlock marker finalizing). */
export function playMoneySound() {
  if (!moneySound) {
    moneySound = new Audio(ASSET_DIR + 'moneysound.mp3');
    moneySound.volume = settings.audio.moneyVolume;
  }
  moneySound.currentTime = 0;
  moneySound.play().catch(() => {});
}

/** One-shot: a supermarket customer's checkout completing. */
export function playBagSound() {
  if (!bagSound) {
    bagSound = new Audio(ASSET_DIR + 'plasticbag.mp3');
    bagSound.volume = settings.audio.bagVolume;
  }
  bagSound.currentTime = 0;
  bagSound.play().catch(() => {});
}
